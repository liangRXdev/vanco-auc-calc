/**
 * summary.js — 臨床摘要組裝（v0.5.1）
 *
 * 純函式、無 DOM、可 node 單測。職責是「把既有計算結果與 safety verdict 重新分層」，
 * 不做任何 PK 計算、不新增模型、不自行重新判讀安全性。
 *
 *   buildClinicalSummary(result, safety, mode) → 結構化摘要物件（供 UI 渲染）
 *   buildClinicalPlan(summary)                 → 臨床簡版純文字（預設複製內容）
 *   buildTechnicalReport(result, safety, mode) → 技術完整版純文字
 *
 * 設計原則：
 *   1. 唯一的安全判斷來源是 safety verdict——「可否給劑量建議」一律讀
 *      safety.allowDoseRecommendation，本檔不重算 AKI/HD/採血時間等條件。
 *   2. AUC 判讀優先取 safety 的訊息碼（AUC_OK / AUC_LOW / AUC_HIGH）。
 *      唯一例外是 Mode 1：經驗起始必須給起始劑量，若把「預測 AUC」送進 classifyAUC，
 *      四捨五入落在 600 邊界就會封鎖起始劑量，臨床上更不安全 → Mode 1 不送 safety，
 *      此處以常數退回判讀，僅供顯示、不參與任何閘門。
 *   3. 摘要只呈現既有欄位；calling code（ui.js）只負責把資料原樣填進 result，
 *      不在 DOM 層做臨床判斷。
 *
 * result 契約（欄位皆 optional，缺者以「—」呈現）：
 *   {
 *     regimenCurrent: { dose, tau, tInf, dailyMg, nDose } | null,   // Mode 1 為 null
 *     currentExposure: { auc24, peak, trough } | null,              // 現行方案暴露
 *     auc24, aucIsProjection, mic, aucOverMic, targetAuc,
 *     recommend: { dose, tau, dailyMg, auc24, peak, trough, impractical } | null,
 *     loading: { dose, capped } | null,                             // Mode 1 負荷劑量
 *     alternatives: [ { dose, tau, dailyMg, auc24, peak, trough, impractical, isCurrent } ],
 *     confidenceFactors: [ '單一濃度', '非穩態', … ],                 // 影響信心的因子（顯示用）
 *     patient: '…',                                                 // 技術版用
 *     technical: { method, lines: [], formula: '' }                 // 技術版用
 *   }
 */
(function (root) {
  const isNode = (typeof require !== 'undefined');
  const C = isNode ? require('./constants.js') : root;
  const SF = isNode ? require('./safety.js') : root.SAFETY;
  const VANCO = C.VANCO;

  const n0 = (v) => (isFinite(v) ? String(Math.round(v)) : '—');
  const n1 = (v) => (isFinite(v) ? v.toFixed(1) : '—');
  const has = (sf, code) => (sf.messages || []).some((m) => m.code === code);

  /** regimen 顯示格式（§八.6）：`1000 mg q12h`。 */
  function regimenText(r) {
    return (r && isFinite(r.dose) && isFinite(r.tau)) ? `${r.dose} mg q${r.tau}h` : '—';
  }
  /** 複製到病歷用：`Vancomycin 1000 mg IV q12h`。 */
  function regimenChartText(r) {
    return (r && isFinite(r.dose) && isFinite(r.tau)) ? `Vancomycin ${r.dose} mg IV q${r.tau}h` : '—';
  }
  const targetRangeText = () => `${VANCO.AUC_TARGET_MIN}–${VANCO.AUC_TARGET_MAX} mg·h/L`;

  const STATUS = {
    ok: { key: 'ok', label: '達標', icon: '✅' },
    low: { key: 'low', label: '低於目標', icon: '⬇️' },
    high: { key: 'high', label: '高於目標', icon: '⬆️' },
    insufficient: { key: 'insufficient', label: '資料不足', icon: '⛔' },
  };
  const BLOCKED_LABEL = '暫不建議調整';

  /** 由 safety 訊息碼取 AUC 判讀（唯一判斷來源）。Mode 1 未送 auc 時回 null。 */
  function aucStatusFromSafety(sf) {
    if (has(sf, 'AUC_HIGH')) return 'high';
    if (has(sf, 'AUC_LOW')) return 'low';
    if (has(sf, 'AUC_OK')) return 'ok';
    return null;
  }
  /** 退回判讀：僅 Mode 1（預測 AUC 不參與閘門）使用，純顯示、不參與任何閘門。 */
  function classifyLocal(auc) {
    if (!isFinite(auc)) return 'insufficient';
    if (auc > VANCO.AUC_AKI_THRESHOLD) return 'high';
    if (auc < VANCO.AUC_TARGET_MIN) return 'low';
    return 'ok';
  }

  // ---------- 閘門成因（code → 中文短句）----------
  // 這些碼即 safety.js 中會使 allowDoseRecommendation=false 的來源。
  // 本表只做「顯示用命名」，不重新判定閘門開關——開關一律讀 verdict。
  const GATE_LABEL = {
    E_PEDIATRIC: '年齡超出適用範圍（僅成人）',
    E_CRRT: 'CRRT / SLED 未涵蓋',
    E_HD: '血液透析（模型未建模透析清除與 post-HD 回彈）',
    E_AKI: '腎功能不穩定 / AKI',
    E_SAMPLE_TIMING: '採血時間不可靠',
    AUC_HIGH: 'AUC 高於目標，須先處置高暴露',
    AUC_NONFINITE: 'AUC 無法計算',
    B_NONFINITE: 'Bayesian 模型輸出非有限值',
    B_NO_CONVERGE: 'Bayesian 最佳化未收斂',
    B_UNSTABLE: 'Bayesian 擬合不穩定（多起點結果不一致）',
    C_NONPOS: '濃度輸入不合理',
    C_TIME_ORDER: '採血時序不合理',
    C_NOT_DECAYING: '兩點濃度未遞減（疑似峰谷填反或分布相採血）',
    C_IN_INFUSION: '第一採血落在輸注期內',
    C_KE_NONPOS: '消除速率非物理值',
    C_AUC_NONFINITE: 'AUC 為非有限值',
  };

  // ---------- 限制短句（code → 1 行）----------
  // 摘要每段最多 1–3 行（§八.2），故對長訊息給短版；未列者退回原文第一句。
  const SHORT = {
    E_PEDIATRIC: '本工具僅適用成人（≥18 歲）。',
    E_CRRT: 'CRRT / SLED 未涵蓋，估計不可信。',
    E_ECMO: 'ECMO：迴路吸附與分布容積改變未建模，可靠度低。',
    E_HD: '血液透析：Goti 未建模透析清除與 post-HD 回彈，不產生具體劑量建議。',
    E_AKI: '腎功能近期變動，本次劑量外推可信度有限。',
    E_DOSE_TIMING: '給藥時間不可靠，估計信心下降。',
    E_SAMPLE_TIMING: '採血時間不可靠，AUC 估計與外推劑量皆不可信。',
    E_PREGNANT: '懷孕：族群 PK 未必適用，請加強監測。',
    E_CF: '囊狀纖維化：CL 常高於一般族群，本先驗可能低估需求。',
    DQ_NON_STEADY: '非穩態取樣：AUC 為穩態投影，非當日實際暴露。',
    DQ_SINGLE_LEVEL: '單一濃度：Vc/Vp 主要仰賴族群先驗。',
    DQ_EMPIRIC: '經驗起始：無實測濃度，全依族群 PK 推估。',
    AUC_HIGH: 'AUC 高於目標：腎毒性風險上升，先處置高暴露。',
    AUC_LOW: 'AUC 低於目標：暴露不足。',
    C_DIST_PHASE: '峰採樣接近分布相，峰值外推偏差較大。',
    C_HALFLIFE: '半衰期超出常見範圍，請確認採血 / 給藥資料。',
    B_ETA_CL: '個體 CL 顯著偏離族群先驗，請確認腎功能與給藥史。',
    B_RESIDUAL: '模型與實測落差大（殘差 > 3×殘差 SD）。',
    INFUSION_RATE_HIGH: '輸注速率過快（屬給藥安全，不影響 AUC 估計）。',
  };
  // 限制排序：先 block，再依臨床影響程度排 warn。未列者排最後。
  const LIMIT_ORDER = [
    'E_PEDIATRIC', 'E_CRRT', 'B_NONFINITE', 'B_NO_CONVERGE', 'B_UNSTABLE',
    'AUC_HIGH', 'E_AKI', 'E_SAMPLE_TIMING', 'E_HD', 'DQ_NON_STEADY',
    'C_DIST_PHASE', 'E_DOSE_TIMING', 'B_RESIDUAL', 'B_ETA_CL', 'C_HALFLIFE',
    'AUC_LOW', 'E_ECMO', 'E_PREGNANT', 'E_CF', 'DQ_SINGLE_LEVEL',
  ];
  const MAX_LIMITATIONS = 3;

  function shortText(m) {
    if (SHORT[m.code]) return SHORT[m.code];
    const first = String(m.text || '').split('。')[0];
    return (first.length > 70 ? first.slice(0, 70) + '…' : first) + '。';
  }

  /** 摘要用限制：只取 block/warn、去重、依 LIMIT_ORDER 排序、最多 3 條（§三.E）。 */
  function pickLimitations(sf) {
    const seen = new Set();
    const picked = [];
    for (const m of (sf.messages || [])) {
      if (m.severity === 'info') continue;
      if (seen.has(m.code)) continue;
      seen.add(m.code);
      picked.push(m);
    }
    picked.sort((a, b) => {
      const ia = LIMIT_ORDER.indexOf(a.code), ib = LIMIT_ORDER.indexOf(b.code);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return picked.slice(0, MAX_LIMITATIONS).map(shortText);
  }

  /** 閘門關閉時的成因清單。可同時成立者全部列出（例：HD + AUC>600）。 */
  function gateReasons(sf) {
    const rs = [];
    for (const m of (sf.messages || [])) {
      if (GATE_LABEL[m.code] && rs.indexOf(GATE_LABEL[m.code]) < 0) rs.push(GATE_LABEL[m.code]);
    }
    if (!rs.length) rs.push('本案安全閘門已擋下劑量建議');
    return rs;
  }

  // ---------- 監測建議（條件式，不虛構日期）----------
  // 觸發條件一律讀 safety 訊息碼，不接受呼叫端另外傳旗標——
  // 否則 ui.js 漏傳一個旗標，摘要就會靜默地少一條監測建議而沒有任何東西轉紅。
  function monitoringLines(mode, canRecommend, sf) {
    const f = {
      declaredAKI: has(sf, 'E_AKI'),
      dialysis: has(sf, 'E_HD'),
      nonSteadyState: has(sf, 'DQ_NON_STEADY'),
      singleLevel: has(sf, 'DQ_SINGLE_LEVEL'),
    };
    const out = [];
    if (!canRecommend) {
      out.push('先確認腎功能趨勢、給藥紀錄與採血時間，再重新計算。');
      if (f.declaredAKI) out.push('腎功能正在變化時，應提早重採濃度，不等待穩態。');
      else out.push('待資料可靠後重新取樣，再評估是否調整。');
    } else if (mode === 1) {
      out.push('建議 24–48 小時內採濃度驗證 AUC 後再調整。');
      if (f.declaredAKI) out.push('已聲明腎功能快速變化：建議提早至 24 小時內複驗，勿沿用固定維持劑量。');
    } else {
      out.push('建議於新方案達穩態後重新監測濃度與 SCr。');
      if (f.declaredAKI) out.push('若腎功能正在變化，應提早監測，不等待穩態。');
      else if (f.nonSteadyState) out.push('本次為穩態投影，達穩態後應再取樣確認。');
      else if (f.singleLevel) out.push('本次為單一濃度，建議複驗時補第 2 點以提高精度。');
    }
    if (f.dialysis) out.push('透析病人須於透析後追加監測（post-HD 回彈未建模）。');
    return out.slice(0, 3);
  }

  // ---------- 主入口 ----------
  function buildClinicalSummary(result, safety, mode) {
    const r = result || {};
    const sf = safety || {};
    // fail-closed：verdict 缺漏（undefined、缺欄位、非布林）一律視為不可計算、不可建議。
    // `!== false` 的寫法會讓「沒有 verdict」等於「允許」，安全邊界的預設值不能朝這個方向倒。
    // safety.js 的 verdict()／merge() 一律產出這兩個布林，正常路徑不受影響。
    const hasVerdict = typeof sf.allowCalculation === 'boolean'
      && typeof sf.allowDoseRecommendation === 'boolean';
    const canCalculate = hasVerdict && sf.allowCalculation;
    const canRecommend = canCalculate && sf.allowDoseRecommendation;

    // Mode 2／3 的判讀一律來自 safety 訊息碼；safety 沒給 AUC 分級就是「資料不足」，
    // 不在此以常數重算一份——否則判讀會與閘門分歧（見上方 classifyLocal 註解）。
    const statusKey = !canCalculate
      ? 'insufficient'
      : (aucStatusFromSafety(sf) || (mode === 1 ? classifyLocal(r.auc24) : 'insufficient'));
    const status = STATUS[statusKey] || STATUS.insufficient;

    // 建議處置：達標則維持現方案（不做不必要調整），否則採主推薦方案。
    // Mode 1 無現行方案 → 一律為起始建議。
    let kind, regimen, exposure;
    if (!canRecommend) {
      kind = 'none'; regimen = null; exposure = null;
    } else if (mode === 1) {
      kind = 'start'; regimen = r.recommend; exposure = r.recommend;
    } else if (statusKey === 'ok') {
      kind = 'maintain'; regimen = r.regimenCurrent; exposure = r.currentExposure;
    } else {
      kind = 'adjust'; regimen = r.recommend; exposure = r.recommend;
    }

    const headline = kind === 'none' ? BLOCKED_LABEL
      : kind === 'start' ? `建議起始 ${regimenText(regimen)}`
      : kind === 'maintain' ? `建議維持現行 ${regimenText(regimen)}`
      : `建議考慮調整為 ${regimenText(regimen)}`;

    const currentText = r.regimenCurrent
      ? `目前 ${regimenChartText(r.regimenCurrent)}`
      : '尚無現行方案（經驗起始）';
    const aucLabel = r.aucLabel || (r.aucIsProjection ? '估計 AUC24（穩態投影）' : '估計 AUC24');

    return {
      mode,
      status,
      blocked: !canRecommend,
      blockedLabel: BLOCKED_LABEL,
      blockedLead: '目前無法安全產生具體劑量建議。',
      canCalculate,
      confidence: sf.confidence || '—',
      // 影響因子由呼叫端以既有勾選/取樣狀態原樣傳入（純資料，不含判斷）；
      // 無因子時退回基準說明，不把「取樣時相合理」這種正面敘述誤標為影響因子。
      confidenceFactors: (r.confidenceFactors || []).filter(Boolean),
      confidenceNote: (r.confidenceFactors || []).filter(Boolean).length
        ? `影響因子：${(r.confidenceFactors || []).filter(Boolean).join('、')}`
        : (r.confidenceBaseNote || ''),
      current: {
        text: currentText,
        regimen: r.regimenCurrent || null,
        auc24: r.auc24,
        aucLabel,
        aucText: `${aucLabel}：${n0(r.auc24)} mg·h/L`,
        verdictText: `判讀：${status.label}（目標 ${targetRangeText()}）`,
        isProjection: !!r.aucIsProjection,
        mic: r.mic,
        aucOverMic: r.aucOverMic,
      },
      recommendation: {
        kind,
        headline,
        regimen: regimen || null,
        regimenText: regimenText(regimen),
        regimenChartText: regimenChartText(regimen),
        loading: (kind === 'start' && r.loading) ? r.loading : null,
        auc24: exposure ? exposure.auc24 : NaN,
        peak: exposure ? exposure.peak : NaN,
        trough: exposure ? exposure.trough : NaN,
        impractical: !!(regimen && regimen.impractical),
      },
      blockedReasons: canRecommend ? [] : gateReasons(sf),
      monitoring: monitoringLines(mode, canRecommend, sf),
      limitations: pickLimitations(sf),
      // AUC>600 時的結構化處置直接取自 safety 層，不另寫一份
      managementSteps: has(sf, 'AUC_HIGH') ? SF.auc600Management() : [],
      alternatives: r.alternatives || [],
    };
  }

  // ---------- 無法計算時的摘要 ----------
  /**
   * 輸入不合法／PK 反算失敗／Bayesian 未收斂時的第一層摘要。
   * 回傳形狀與 buildClinicalSummary 相容（`current` 為 null），故可共用同一個 renderSummary。
   * 存在的理由：§八.8 要求「所有 BLOCK 狀態都必須有明確下一步」——
   * 失敗訊息不得只寫進預設收合的第四層，否則使用者按下計算後第一屏是空的。
   */
  function buildFatalSummary(reasons, nextSteps, mode) {
    const rs = [].concat(reasons || []).filter(Boolean);
    const ns = [].concat(nextSteps || []).filter(Boolean);
    return {
      mode,
      status: STATUS.insufficient,
      blocked: true,
      blockedLabel: '無法計算',
      blockedLead: '本次計算未完成，沒有可用的結果。',
      canCalculate: false,
      confidence: '—',
      confidenceFactors: [],
      confidenceNote: '',
      current: null,
      recommendation: {
        kind: 'none', headline: BLOCKED_LABEL, regimen: null,
        regimenText: '—', regimenChartText: '—', loading: null,
        auc24: NaN, peak: NaN, trough: NaN, impractical: false,
      },
      blockedReasons: rs.length ? rs : ['輸入資料無法完成計算'],
      monitoring: ns.length ? ns : ['請修正上列問題後重新計算。'],
      limitations: [],
      managementSteps: [],
      alternatives: [],
    };
  }

  // ---------- 自訂試算附註 ----------
  /**
   * 使用者自訂 what-if 試算的附註文字。
   * BLOCK 時**臨床簡版一律不得帶任何具體劑量／間隔**（§四.3、§十.8）——
   * 臨床簡版是預設複製內容、落點是病歷，附一句「此試算同不可靠」不能抵銷該禁令。
   * 技術完整版可保留數值供覆核，但須標明閘門成因。
   *
   * @param {object|null} custom  { dose, tau, tInf?, dailyMg, auc24, peak, trough, rateNote? }
   * @param {object} summary      buildClinicalSummary() 的回傳（blocked 的唯一來源）
   * @param {'clinical'|'technical'} variant
   * @returns {string} 附註；無試算時回空字串
   */
  function customSimulationNote(custom, summary, variant) {
    if (!custom) return '';
    const s = summary || {};
    const blocked = !!s.blocked;
    const reasons = (s.blockedReasons || []).join('；');
    if (blocked && variant === 'clinical') {
      return '★ 曾執行自訂試算，因本案安全閘門已擋下劑量建議而未納入本摘要。'
        + (reasons ? `（成因：${reasons}）` : '');
    }
    const inf = isFinite(custom.tInf) ? `輸注 ${custom.tInf}h，` : '';
    let out = `★ 自訂試算（使用者指定，非系統建議）：${custom.dose} mg q${custom.tau}h`
      + `（${inf}${n0(custom.dailyMg)} mg/day）→ AUC24 ${n0(custom.auc24)}、`
      + `peak/trough ${n1(custom.peak)}/${n1(custom.trough)} mg/L`;
    if (custom.rateNote) out += `\n   💧 ${custom.rateNote}`;
    if (blocked) {
      out += `\n   （本案安全閘門已擋下劑量建議${reasons ? '：' + reasons : ''}；此試算同不可靠。）`;
    }
    return out;
  }
  /** 把附註接到既有文字末尾；無試算時原樣返回。 */
  function appendCustomSimulation(text, custom, summary, variant) {
    const note = customSimulationNote(custom, summary, variant);
    return note ? `${text}\n\n${note}` : text;
  }

  // ---------- 臨床簡版 Plan（預設複製內容）----------
  function buildClinicalPlan(summary) {
    const s = summary;
    if (!s) return '';
    const L = ['Vancomycin TDM 評估', ''];

    // s.current 為 null 代表本次根本沒算出結果（buildFatalSummary），跳過現況與評估段。
    if (s.current) {
      L.push('目前 regimen：');
      L.push(s.current.regimen ? regimenChartText(s.current.regimen) : '尚無現行方案（經驗起始）');
      L.push('');

      L.push('評估：');
      L.push(`${s.current.aucLabel} ${n0(s.current.auc24)} mg·h/L，${s.status.label}（目標 ${targetRangeText()}）。`);
      L.push(`本次資料信心：${s.confidence}。`);
      L.push('');
    }

    L.push('建議：');
    if (s.blocked) {
      L.push(s.blockedLead || '目前無法安全產生具體劑量建議。');
      L.push('原因：');
      s.blockedReasons.forEach((x) => L.push(`- ${x}`));
      if (s.managementSteps.length) {
        L.push('高暴露處置：');
        s.managementSteps.forEach((x) => L.push(`- ${x}`));
      }
    } else {
      if (s.recommendation.loading) {
        L.push(`負荷：Vancomycin ${s.recommendation.loading.dose} mg IV`
          + `${s.recommendation.loading.capped ? '（已封頂 3000 mg）' : ''}。`);
      }
      const verb = s.recommendation.kind === 'start' ? '起始'
        : s.recommendation.kind === 'maintain' ? '維持現行' : '考慮調整為';
      L.push(`${verb} ${s.recommendation.regimenChartText}。`);
      L.push(`預估 AUC24 ${n0(s.recommendation.auc24)} mg·h/L，`
        + `peak ${n1(s.recommendation.peak)} mg/L，trough ${n1(s.recommendation.trough)} mg/L。`);
      if (s.recommendation.impractical) L.push('註：單次劑量偏大，可考慮縮短間隔。');
    }
    L.push('');

    L.push('監測：');
    s.monitoring.forEach((x) => L.push(x));

    if (s.limitations.length) {
      L.push('');
      L.push('注意：');
      s.limitations.forEach((x) => L.push(x));
    }

    L.push('');
    L.push('仍應整合感染部位、MIC、臨床反應與腎功能趨勢，由醫師／藥師覆核。');
    return L.join('\n');
  }

  // ---------- 技術完整版 ----------
  function buildTechnicalReport(result, safety, mode) {
    const r = result || {};
    const sf = safety || {};
    const t = r.technical || {};
    const summary = buildClinicalSummary(r, sf, mode);
    const L = [`【Vancomycin 完整 PK 報告】Mode ${mode}${t.method ? '｜' + t.method : ''}`];

    if (r.patient) L.push(`病人：${r.patient}`);
    L.push(r.regimenCurrent
      ? `現行方案：${regimenChartText(r.regimenCurrent)}`
        + (isFinite(r.regimenCurrent.dailyMg) ? `（${n0(r.regimenCurrent.dailyMg)} mg/day）` : '')
        + (isFinite(r.regimenCurrent.nDose) ? `，第 ${r.regimenCurrent.nDose} 劑` : '')
        + (isFinite(r.regimenCurrent.tInf) ? `，輸注 ${r.regimenCurrent.tInf}h` : '')
      : '現行方案：無（經驗起始）');
    L.push(`${summary.current.aucLabel}：${n0(r.auc24)} mg·h/L（目標 ${targetRangeText()}）→ ${summary.status.label}`
      + (isFinite(r.aucOverMic) ? `；AUC/MIC ${n0(r.aucOverMic)}（MIC ${r.mic}）` : ''));

    if (t.lines && t.lines.length) {
      L.push('', 'PK 參數：');
      t.lines.forEach((x) => L.push(`  ${x}`));
    }

    L.push('', `資料信心：${sf.confidence}（safety status ${sf.status}）`);
    L.push(`可計算：${sf.allowCalculation ? '是' : '否'}｜可出劑量建議：${sf.allowDoseRecommendation ? '是' : '否'}`);

    const msgs = (sf.messages || []);
    if (msgs.length) {
      L.push('', 'Safety messages（完整）：');
      msgs.forEach((m) => L.push(`  [${m.severity}] ${m.code}：${m.text}`));
    }

    if (summary.managementSteps.length) {
      L.push('', 'AUC>600 結構化處置：');
      summary.managementSteps.forEach((x) => L.push(`  · ${x}`));
    }

    if (!summary.blocked && summary.recommendation.regimen) {
      L.push('', `主要建議：${summary.recommendation.regimenChartText}`
        + `→ 預估 AUC24 ${n0(summary.recommendation.auc24)}、`
        + `peak/trough ${n1(summary.recommendation.peak)}/${n1(summary.recommendation.trough)} mg/L`);
    } else {
      L.push('', '主要建議：不輸出（安全閘門）。成因：' + summary.blockedReasons.join('；'));
    }

    if (r.alternatives && r.alternatives.length) {
      L.push('', summary.blocked
        ? '外推方案（本案不可直接採用，僅供理解暴露-劑量關係）：'
        : '其他候選方案：');
      r.alternatives.forEach((o) => {
        L.push(`  · ${o.dose} mg q${o.tau}h（${n0(o.dailyMg)} mg/day）｜`
          + `peak/trough ${n1(o.peak)}/${n1(o.trough)}、AUC24 ${n0(o.auc24)}`
          + `${o.impractical ? '（單次過大）' : ''}${o.isCurrent ? ' ★維持原間隔' : ''}`);
      });
    }

    L.push('', '監測：');
    summary.monitoring.forEach((x) => L.push(`  ${x}`));

    if (t.formula) L.push('', '計算式 / 模型細節：', t.formula);

    L.push('', '本工具僅供臨床決策輔助，不取代專業判斷；所有劑量須經藥師 / 醫師覆核。');
    return L.join('\n');
  }

  const api = {
    buildClinicalSummary, buildClinicalPlan, buildTechnicalReport,
    buildFatalSummary, customSimulationNote, appendCustomSimulation,
    regimenText, regimenChartText, targetRangeText,
    // 供測試檢視
    _internal: { GATE_LABEL, SHORT, LIMIT_ORDER, MAX_LIMITATIONS },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SUMMARY = api;
})(typeof self !== 'undefined' ? self : this);
