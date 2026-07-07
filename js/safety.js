/**
 * safety.js — 萬古黴素計算器的確定性安全層（v0.3.0）
 *
 * 純函式、無相依（僅引用 constants.js 的臨床數值，不寫死）、可 node 單測。
 * 職責：把「可算 AUC」與「可給劑量建議」分離，於臨床聲明超出模型能力時
 *       降級（WARNING）或阻擋（BLOCK），比程式功能更保守。
 *
 * 統一回傳 verdict：
 *   {
 *     status: "OK" | "WARNING" | "BLOCK",
 *     confidence: "High" | "Moderate" | "Low" | "Invalid",
 *     messages: [{ code, severity: "info"|"warn"|"block", text }],
 *     allowCalculation: boolean,
 *     allowDoseRecommendation: boolean   // 可算 AUC ≠ 可給劑量建議
 *   }
 *
 * 設計原則（見 toClaudeCode_v0.3_integrated Part A/B）：
 *   - 系統可判定者（年齡、CRRT、HD 被選）自動觸發；
 *   - 無法自動偵測者（AKI、時間不可靠、懷孕、CF）須由呼叫端傳入使用者聲明旗標，不假裝能偵測。
 *   - 過度保守（把懷孕/CF 一律 BLOCK）會逼使用者改用更不安全的手算 → 這些為 WARNING。
 *
 * 對應 wiki: source-goti2018-vancomycin-popPK-HD、concept-Vancomycin-AUC-TDM。
 */
(function (root) {
  const C = (typeof require !== 'undefined') ? require('./constants.js') : root;
  const VANCO = C.VANCO;
  const GOTI = C.GOTI;

  const SEV_RANK = { info: 0, warn: 1, block: 2 };
  const CONF_RANK = { Invalid: 0, Low: 1, Moderate: 2, High: 3 };
  const CONF_NAME = ['Invalid', 'Low', 'Moderate', 'High'];

  function msg(code, severity, text) { return { code, severity, text }; }

  /** 由 messages 與基準旗標組出完整 verdict。 */
  function verdict(messages, opts) {
    const o = Object.assign({ allowCalculation: true, allowDoseRecommendation: true, confidence: 'High' }, opts || {});
    const hasBlock = messages.some((m) => m.severity === 'block');
    const hasWarn = messages.some((m) => m.severity === 'warn');
    const status = hasBlock ? 'BLOCK' : hasWarn ? 'WARNING' : 'OK';
    return {
      status,
      confidence: hasBlock ? 'Invalid' : o.confidence,
      messages,
      allowCalculation: hasBlock ? false : o.allowCalculation,
      allowDoseRecommendation: (hasBlock || !o.allowCalculation) ? false : o.allowDoseRecommendation,
    };
  }

  /** 合併多個 verdict（訊息串接、旗標取 AND、confidence 取最低、status 取最嚴）。 */
  function merge() {
    const verdicts = [].slice.call(arguments).filter(Boolean);
    const messages = [];
    let allowCalculation = true;
    let allowDoseRecommendation = true;
    let confRank = CONF_RANK.High;
    for (const v of verdicts) {
      for (const m of v.messages) messages.push(m);
      allowCalculation = allowCalculation && v.allowCalculation;
      allowDoseRecommendation = allowDoseRecommendation && v.allowDoseRecommendation;
      confRank = Math.min(confRank, CONF_RANK[v.confidence]);
    }
    const hasBlock = messages.some((m) => m.severity === 'block') || !allowCalculation;
    const hasWarn = messages.some((m) => m.severity === 'warn');
    return {
      status: hasBlock ? 'BLOCK' : hasWarn ? 'WARNING' : 'OK',
      confidence: hasBlock ? 'Invalid' : CONF_NAME[confRank],
      messages,
      allowCalculation: !hasBlock,
      allowDoseRecommendation: !hasBlock && allowDoseRecommendation,
    };
  }

  function lowerConf(current, floor) {
    return CONF_NAME[Math.min(CONF_RANK[current], CONF_RANK[floor])];
  }

  // ---------- A1/A2 Eligibility ----------
  /**
   * input（旗標皆 optional，預設 false）：
   *   系統可判定：age, crrt, sled, ecmo, dialysis(HD 被選)
   *   使用者聲明：declaredAKI, declaredUnreliableDoseTiming, declaredUnreliableSampleTiming,
   *              pregnant, cysticFibrosis
   */
  function evaluateEligibility(input) {
    const i = input || {};
    const m = [];
    let confidence = 'High';
    let allowDoseRecommendation = true;

    // --- 系統可判定 ---
    if (i.age != null && i.age < VANCO.RANGES.age.min) {
      m.push(msg('E_PEDIATRIC', 'block',
        `本工具僅適用成人（≥${VANCO.RANGES.age.min} 歲）。小兒 PK 與劑量方式不同，請另參小兒指引。`));
    }
    if (i.crrt || i.sled) {
      m.push(msg('E_CRRT', 'block',
        'CRRT / SLED 未涵蓋：Goti 2018 先驗不含持續性腎替代療法清除，估計不可信。'));
    }
    if (i.ecmo) {
      m.push(msg('E_ECMO', 'warn',
        'ECMO：迴路吸附與分布容積改變未建模，估計可靠度低，請以臨床判斷為主。'));
      confidence = lowerConf(confidence, 'Low');
    }
    if (i.dialysis) {
      m.push(msg('E_HD', 'warn',
        'Goti 模型僅含血液透析二元共變數（CL×0.7、Vc×0.5）；透析清除、intradialytic dosing、'
        + 'post-HD 再分布均未建模。HD 之 Bayesian 輸出為 experimental / research-use，'
        + '不產生具體劑量建議，須臨床人員自行判斷。'));
      confidence = lowerConf(confidence, 'Low');
      allowDoseRecommendation = false;
    }

    // --- 使用者聲明（無法自動偵測）---
    if (i.declaredAKI) {
      m.push(msg('E_AKI', 'warn',
        '已聲明腎功能快速變化 / AKI：CL 由單一時點外推至穩態不可靠，僅供參考，不產生劑量建議。'));
      confidence = lowerConf(confidence, 'Low');
      allowDoseRecommendation = false;
    }
    if (i.declaredUnreliableDoseTiming) {
      m.push(msg('E_DOSE_TIMING', 'warn',
        '已聲明給藥時間不可靠：Mode 2/3 依賴精確給藥史，估計信心下降。'));
      confidence = lowerConf(confidence, 'Moderate');
    }
    if (i.declaredUnreliableSampleTiming) {
      m.push(msg('E_SAMPLE_TIMING', 'warn',
        '已聲明採血時間不可靠：AUC 估計標為不可信，請重新確認採血時刻。'));
      confidence = lowerConf(confidence, 'Moderate');
    }
    if (i.pregnant) {
      m.push(msg('E_PREGNANT', 'warn',
        '懷孕：族群 PK 未必適用（Vd/CL 於妊娠改變），仍允許計算，請加強監測。'));
      confidence = lowerConf(confidence, 'Moderate');
    }
    if (i.cysticFibrosis) {
      m.push(msg('E_CF', 'warn',
        '囊狀纖維化：CL 常高於一般族群，本先驗可能低估需求，請加強監測。'));
      confidence = lowerConf(confidence, 'Moderate');
    }

    return verdict(m, { confidence, allowDoseRecommendation });
  }

  // ---------- A / 資料品質信心分層（由 v0.3.1 L2 shrinkage 背書）----------
  /**
   * 依「取樣資訊量」給 Mode 3 信心 tier。門檻由 L2（N=1000）shrinkage(CL) 背書：
   *   穩態峰+谷 0.21、兩隨機 0.25、穩態單谷 0.27、非穩態首劑 0.77。
   *   shrinkage 越低＝資料對 CL 資訊量越高 → 信心越高。
   * 對映：穩態 ≥2 點→High；穩態單點→Moderate；非穩態（尤單早期點，CL 由先驗主導）→Low。
   * input: { nLevels, steadyState (true/false/null) }；mode: 1|2|3
   */
  function evaluateDataQuality(input, mode) {
    const i = input || {};
    const m = [];
    let tier = 'High';
    if (mode === 3) {
      const nonSteady = i.steadyState === false;
      if (nonSteady) {
        tier = 'Low';
        m.push(msg('DQ_NON_STEADY', 'warn',
          '非穩態取樣：AUC₂₄ = 每日總量 / CL 為「穩態投影」非當日實際暴露；'
          + '早期單點對 CL 資訊量低（L2 shrinkage 0.77，估計貼近先驗）→ 信心 Low。'));
        if (i.nLevels === 1) m.push(msg('DQ_SINGLE_LEVEL', 'info',
          '單一濃度：Vc/Vp 主要仰賴族群先驗、峰值不確定性大；建議穩態後補第 2 點。'));
      } else if (i.nLevels === 1) {
        tier = 'Moderate';
        m.push(msg('DQ_SINGLE_LEVEL', 'info',
          '穩態單一濃度：CL 依實測更新（L2 shrinkage 0.27）、Vc/Vp 仰賴先驗 → 信心 Moderate。'));
      } else {
        tier = 'High';
        m.push(msg('DQ_TWO_LEVEL', 'info',
          '穩態雙點：CL 資訊量佳（L2 shrinkage ~0.21）→ 信心 High。'));
      }
    }
    return verdict(m, { confidence: tier });
  }

  // ---------- B1 Mode 2 濃度守衛 ----------
  /**
   * levels: { c1, t1, c2, t2 }（時刻＝距本次輸注開始 h）
   * dosing: { tau, tInf }
   * pk（optional，已算出者）: { ke, halfLife, auc24 } 供 NaN / 半衰期合理性檢查
   * 分布期分級：距 infusion end = t1 − tInf。
   */
  function validateConcentrations(levels, dosing, pk) {
    const { c1, t1, c2, t2 } = levels || {};
    const { tau, tInf } = dosing || {};
    const m = [];

    // --- BLOCK：一階消除與取樣位置的硬性前提 ---
    if (!(c1 > 0) || !(c2 > 0)) m.push(msg('C_NONPOS', 'block', '濃度須 > 0。'));
    if (!(t2 > t1)) m.push(msg('C_TIME_ORDER', 'block', '第二採血時刻須晚於第一。'));
    if (c1 > 0 && c2 > 0 && c2 >= c1) m.push(msg('C_NOT_DECAYING', 'block',
      '第二點濃度須低於第一點（消除期應遞減；確認未把峰/谷填反或在分布期採血）。'));
    if (t1 < tInf) m.push(msg('C_IN_INFUSION', 'block',
      `第一採血落在輸注期內（t1 ${t1} < 輸注 ${tInf}h），一階外推公式不適用。`));

    if (pk) {
      if (!(pk.ke > 0)) m.push(msg('C_KE_NONPOS', 'block', 'ke ≤ 0（非物理消除），無法計算。'));
      if (!isFinite(pk.auc24)) m.push(msg('C_AUC_NONFINITE', 'block', 'AUC 為 NaN/Infinity，輸入不合理。'));
      if (isFinite(pk.halfLife) && (pk.halfLife < 1 || pk.halfLife > 100)) m.push(msg('C_HALFLIFE', 'warn',
        `半衰期 ${pk.halfLife.toFixed(1)}h 超出常見範圍（1–100h），請確認採血/給藥資料。`));
    }

    // --- 分布期分級（僅在時序合理時評估）---
    let confidence = 'High';
    if (t1 != null && tInf != null && t1 >= tInf) {
      const gap = t1 - tInf; // 距輸注結束
      if (gap < 0.5) {
        m.push(msg('C_DIST_PHASE', 'warn',
          `第一點距輸注結束僅 ${gap.toFixed(2)}h（<0.5h），仍在分布相，峰值外推偏差大；建議輸注結束 ≥1–2h 後採峰。`));
        confidence = lowerConf(confidence, 'Low');
      } else if (gap < 1) {
        m.push(msg('C_DIST_PHASE', 'warn',
          `第一點距輸注結束 ${gap.toFixed(2)}h（0.5–1h），可能仍受分布相影響。`));
        confidence = lowerConf(confidence, 'Moderate');
      }
    }

    return verdict(m, { confidence });
  }

  // ---------- B2 Mode 3 Bayesian 擬合守衛 ----------
  /**
   * result：bayesianMAP 回傳物件（需含 converged, fitReliable, nonFinite, eta, predictedAtObs）。
   * 注意：ηVc/ηVp 門檻不與 ηCL 相同——1–2 點時 Vc/Vp 由先驗主導、η 小屬正常，不觸發 WARNING。
   */
  function validateBayesianFit(result) {
    const r = result || {};
    const m = [];
    let confidence = 'High';

    if (r.nonFinite) m.push(msg('B_NONFINITE', 'block',
      '模型輸出含 NaN/Infinity（給藥史或濃度不合理），無法產生可信估計。'));
    if (r.converged === false) m.push(msg('B_NO_CONVERGE', 'block',
      '最佳化未收斂：目標函數未達停止準則，估計不可信。'));
    if (r.fitReliable === false) m.push(msg('B_UNSTABLE', 'block',
      '多起點最佳化結果不一致（可能陷入局部解）：估計不穩定，請檢查輸入。'));

    // WARNING：posterior 遠離 prior（僅看 ηCL）
    const wCL = Math.sqrt(GOTI.OMEGA2_CL);
    if (r.eta && isFinite(r.eta.cl) && Math.abs(r.eta.cl) > 2 * wCL) {
      m.push(msg('B_ETA_CL', 'warn',
        `個體 CL 顯著偏離族群先驗（|ηCL| ${Math.abs(r.eta.cl).toFixed(2)} > 2ω ${(2 * wCL).toFixed(2)}）：`
        + '確認腎功能與給藥史，或考慮不適用此先驗族群。'));
      confidence = lowerConf(confidence, 'Moderate');
    }

    // WARNING：殘差超過殘差 SD 數倍（predicted−observed）
    if (Array.isArray(r.predictedAtObs)) {
      for (const p of r.predictedAtObs) {
        const sd = Math.sqrt(Math.pow(GOTI.ERR_PROP * p.predicted, 2) + Math.pow(GOTI.ERR_ADD, 2));
        if (isFinite(sd) && sd > 0 && Math.abs(p.predicted - p.observed) > 3 * sd) {
          m.push(msg('B_RESIDUAL', 'warn',
            `擬合殘差 ${(p.predicted - p.observed).toFixed(1)} mg/L 超過 3×殘差 SD：模型與實測落差大，estimate 可靠度下降。`));
          confidence = lowerConf(confidence, 'Low');
          break;
        }
      }
    }

    return verdict(m, { confidence });
  }

  // ---------- B3 輸出安全：AUC 分級 ----------
  /**
   * auc：AUC₂₄ 數值。回傳 verdict；AUC>600 時 allowDoseRecommendation=false（改結構化處置）。
   */
  function classifyAUC(auc) {
    const m = [];
    if (!isFinite(auc)) {
      return verdict([msg('AUC_NONFINITE', 'block', 'AUC 非有限值，無法判讀。')], {});
    }
    if (auc > VANCO.AUC_AKI_THRESHOLD) {
      m.push(msg('AUC_HIGH', 'warn',
        `AUC₂₄ ${auc.toFixed(0)} > ${VANCO.AUC_AKI_THRESHOLD}：腎毒性風險上升。不逕給單行減量建議，`
        + '請依結構化處置評估。'));
      return verdict(m, { allowDoseRecommendation: false, confidence: 'Moderate' });
    }
    if (auc < VANCO.AUC_TARGET_MIN) {
      m.push(msg('AUC_LOW', 'warn',
        `AUC₂₄ ${auc.toFixed(0)} < ${VANCO.AUC_TARGET_MIN}：暴露不足，建議加量並複驗。`));
      return verdict(m, { confidence: 'Moderate' });
    }
    m.push(msg('AUC_OK', 'info', `AUC₂₄ ${auc.toFixed(0)} 落於目標 ${VANCO.AUC_TARGET_MIN}–${VANCO.AUC_TARGET_MAX}。`));
    return verdict(m, {});
  }

  /** AUC>600 的結構化處置清單（供 UI 取代單行減量建議）。 */
  function auc600Management() {
    return [
      '評估延後 / 暫停下一劑',
      '查 SCr、尿量、其他腎毒性藥物（合併使用會加乘風險）',
      '確認給藥時間與採血時間是否正確（高 AUC 常源自時間登錄錯誤）',
      '穩定後重新 TDM 取樣',
      '劑量調整須由藥師 / 醫師覆核',
    ];
  }

  // ---------- 聚合入口 ----------
  /**
   * 依 context 呼叫相關子檢查並合併。context 欄位皆 optional：
   *   { eligibility, dataQuality:{input,mode}, concentrations:{levels,dosing,pk},
   *     bayesFit, auc }
   */
  function buildSafetyMessages(context) {
    const c = context || {};
    const parts = [];
    if (c.eligibility) parts.push(evaluateEligibility(c.eligibility));
    if (c.dataQuality) parts.push(evaluateDataQuality(c.dataQuality.input, c.dataQuality.mode));
    if (c.concentrations) parts.push(validateConcentrations(c.concentrations.levels, c.concentrations.dosing, c.concentrations.pk));
    if (c.bayesFit) parts.push(validateBayesianFit(c.bayesFit));
    if (c.auc != null) parts.push(classifyAUC(c.auc));
    return merge.apply(null, parts);
  }

  const api = {
    evaluateEligibility, evaluateDataQuality,
    validateConcentrations, validateBayesianFit,
    classifyAUC, auc600Management,
    buildSafetyMessages, merge, verdict,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SAFETY = api;
})(typeof self !== 'undefined' ? self : this);
