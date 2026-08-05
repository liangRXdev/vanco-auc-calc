/* ui.js — DOM 綁定：讀輸入 → 呼叫 PK → 渲染結果 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const num = (id) => parseFloat($(id).value);
  const fmt = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '—');
  let simCtx = null;  // Mode 2：最近一次反算的個人化 PK，供自訂試算沿用
  let bSimCtx = null; // Mode 3：最近一次 MAP 的個體 PK（二室），供自訂試算沿用
  // 兩種可複製版本（§六）：臨床簡版為預設複製內容，技術完整版另按鈕
  const planText = { e: '', a: '', b: '' };
  const techText = { e: '', a: '', b: '' };
  // 第二層（替代方案／外推參考）另有一份可複製文字，與臨床簡版分開，
  // 按鈕名稱亦隨閘門狀態改變——不能讓外推值混進「複製臨床摘要」。
  const altText = { a: '', b: '' };
  /** 依閘門狀態更新第二層複製鈕的顯示與名稱。 */
  function syncAltCopy(prefix, blocked) {
    const btn = $(prefix + '-copy-alt');
    if (!btn) return;                      // Mode 1 無第二層
    btn.hidden = !altText[prefix];
    btn.textContent = blocked ? '複製外推參考（不可直接採用）' : '複製替代方案';
  }

  // ---------- Tab 切換 ----------
  document.querySelectorAll('.tabs__btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs__btn').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('tabs__btn--active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      document.querySelectorAll('.panel').forEach((p) => {
        const on = p.id === btn.dataset.panel;
        p.classList.toggle('panel--active', on);
        p.hidden = !on;
      });
    });
  });

  // ---------- 小工具 ----------
  // 一律 esc()：目前三個輸入來源都是 parseFloat 後的 number、無外部資料源，
  // 但這是唯一會把值插進 innerHTML 的通道，統一逸出成本近零、日後接外部資料才不會漏。
  function metric(label, value, unit, primary) {
    return `<div class="metric${primary ? ' metric--primary' : ''}">
      <div class="metric__label">${esc(label)}</div>
      <div class="metric__value">${esc(value)}<span class="metric__unit">${esc(unit || '')}</span></div>
    </div>`;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }
  function renderWarnings(el, warnings) {
    el.innerHTML = (warnings || []).map((w) => {
      const icon = w.level === 'warn' ? '⚠️' : w.level === 'error' ? '⛔' : 'ℹ️';
      return `<div class="alert alert--${w.level}"><span>${icon}</span><span>${esc(w.msg)}</span></div>`;
    }).join('');
  }
  // safety verdict 的 messages → renderWarnings 慣用格式
  const SEV2LEVEL = { block: 'error', warn: 'warn', info: 'info' };
  function safetyWarnings(verdict) {
    return (verdict.messages || []).map((m) => ({ level: SEV2LEVEL[m.severity] || 'info', msg: m.text }));
  }
  // ---------- 第一層：臨床摘要渲染 ----------
  // 只把 SUMMARY 產生的欄位排版，不在此重新判讀 safety、AUC 或 eligibility。
  // 順序固定：狀態 → 目前評估 → 建議 → 監測 → 限制（結論先於數據）。
  const ul = (items, ordered) => {
    const tag = ordered ? 'ol' : 'ul';
    return `<${tag} class="summary__list">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</${tag}>`;
  };
  function renderSummary(el, s) {
    const out = [];

    // A. 狀態列（顏色 + icon + 文字，不單靠顏色辨識）
    out.push('<div class="summary__status">'
      + `<span class="summary__badge summary__badge--${s.status.key}">${s.status.icon} ${esc(s.status.label)}</span>`
      + (s.blocked ? `<span class="summary__badge summary__badge--blocked">⛔ ${esc(s.blockedLabel)}</span>` : '')
      + `<span class="summary__badge summary__badge--conf-${String(s.confidence).toLowerCase()}">資料信心：${esc(s.confidence)}</span>`
      + '</div>');

    // B. 目前評估（s.current 為 null 代表本次未算出結果，整段略過）
    if (s.current) {
      out.push('<div class="summary__block">'
        + '<div class="summary__label">目前評估</div>'
        + `<div class="summary__line summary__line--strong">${esc(s.current.text)}</div>`
        + `<div class="summary__auc">${fmt(s.current.auc24, 0)}`
        + `<span class="summary__auc-unit">mg·h/L　${esc(s.current.aucLabel)}</span></div>`
        + `<div class="summary__line">${esc(s.current.verdictText)}</div>`
        + (s.confidenceNote ? `<div class="summary__note">${esc(s.confidenceNote)}</div>` : '')
        + '</div>');
    }

    // C. 建議處置
    if (s.blocked) {
      out.push('<div class="summary__block summary__block--blocked">'
        + '<div class="summary__label">建議處置</div>'
        + `<div class="summary__line summary__line--strong">${esc(s.blockedLead || '目前無法安全產生具體劑量建議。')}</div>`
        + '<div class="summary__line">原因：</div>' + ul(s.blockedReasons)
        + (s.managementSteps.length
          ? '<div class="summary__line">高暴露處置：</div>' + ul(s.managementSteps, true) : '')
        + '</div>');
    } else {
      const r = s.recommendation;
      out.push('<div class="summary__block summary__block--rec">'
        + '<div class="summary__label">建議</div>'
        + `<div class="summary__line summary__line--strong">${esc(r.headline)}</div>`
        + (r.loading
          ? `<div class="summary__line">負荷劑量：${r.loading.dose} mg`
            + `${r.loading.capped ? '（已封頂 3000 mg）' : ''}</div>` : '')
        + (r.impractical ? '<div class="summary__note">⚠ 單次劑量偏大，可考慮縮短間隔。</div>' : '')
        + (r.caveat ? `<div class="summary__caveat">⚠ ${esc(r.caveat)}</div>` : '')
        + '<div class="summary__label" style="margin-top:.6rem">預估（模型預測，非醫囑）</div>'
        + `<div class="summary__line">預估 AUC24：${fmt(r.auc24, 0)} mg·h/L</div>`
        + `<div class="summary__line">預估 peak／trough：${fmt(r.peak, 1)}／${fmt(r.trough, 1)} mg/L</div>`
        + '</div>');
    }

    // D. 下一步監測
    out.push('<div class="summary__block">'
      + `<div class="summary__label">${s.blocked ? '建議下一步' : '下一步監測'}</div>`
      + ul(s.monitoring) + '</div>');

    // E. 主要限制（最多 3 條；完整聲明留在第四層與頁尾）
    if (s.limitations.length) {
      out.push('<div class="summary__block">'
        + '<div class="summary__label">主要限制</div>' + ul(s.limitations) + '</div>');
    }

    el.innerHTML = out.join('');
  }
  // 複製按鈕：寫入 clipboard，失敗則退回 execCommand
  function wireCopy(btnId, getText) {
    $(btnId).addEventListener('click', async () => {
      const txt = getText();
      try { await navigator.clipboard.writeText(txt); }
      catch (e) {
        const ta = document.createElement('textarea');
        ta.value = txt; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch (_) {}
        document.body.removeChild(ta);
      }
      const btn = $(btnId); const old = btn.textContent;
      btn.textContent = '✓ 已複製'; btn.classList.add('is-copied');
      setTimeout(() => { btn.textContent = old; btn.classList.remove('is-copied'); }, 1600);
    });
  }
  function markError(ids, on) { ids.forEach((id) => $(id).classList.toggle('field__input--error', on)); }

  // ---------- 輸注速率（給藥安全，三模式共用）----------
  // 建議 10–15 mg/min（或 1g/60min），警示門檻另訂 >17 mg/min——兩者語意分離，
  // 理由見 constants.js。不影響 AUC（=每日總量/CL），故一律以 muted 小提示呈現、
  // 不升級為 alert、不擋劑量建議。
  /** tInf 已知：逾警示門檻（>17 mg/min 或 <60min）時回傳提示文字，否則 null。 */
  function infusionWarnText(dose, tInf) {
    const v = SAFETY.checkInfusionRate(dose, tInf);
    return v.messages.length ? v.messages[0].text : null;
  }
  /** 單一劑量的建議輸注時長字串：受 60min 下限夾住時退為單值。 */
  function advisedInfText(dose) {
    const [a, b] = SAFETY.advisedInfusionRangeH(dose);
    return Math.abs(a - b) < 1e-9 ? `${fmt(a, 1)}h` : `${fmt(a, 1)}–${fmt(b, 1)}h`;
  }
  /** tInf 未知（Mode 1 不收此輸入）：陳述建議區間（10–15 mg/min）。caveat 為選填補述。 */
  function infusionReqText(pairs, caveat) {
    const xs = (pairs || []).filter((p) => p && isFinite(p.dose) && p.dose > 0);
    if (!xs.length) return null;
    return '建議輸注時長：' + xs.map((p) => `${p.label} ${p.dose} mg ${advisedInfText(p.dose)}`).join('、')
      + '（10–15 mg/min，或 1g/60min）'
      + (caveat ? `。${caveat}` : '');
  }
  const infusionHintHTML = (t) => (t ? `<p class="hint hint--muted">💧 ${esc(t)}</p>` : '');

  // ---------- Mode 1：經驗起始 ----------
  $('e-calc').addEventListener('click', () => {
    const ids = ['e-age', 'e-height', 'e-tbw', 'e-scr'];
    const bad = ids.filter((id) => !isFinite(num(id)) || num(id) <= 0);
    markError(ids, false); markError(bad, true);
    if (bad.length) { alertResult('e', '請完整填入病人基本資料（數值須 > 0）。'); return; }
    if (num('e-age') < 18) {
      markError(['e-age'], true);
      alertResult('e', '本工具僅適用成人（≥18 歲）。小兒萬古黴素劑量方式不同（60–80 mg/kg/day，Cockcroft-Gault 亦不適用），請另參小兒指引。');
      return;
    }

    const targetAuc = num('e-target') || VANCO.AUC_TARGET_DEFAULT;
    const clModel = document.querySelector('input[name="e-clmodel"]:checked').value;
    const r = PK.empiricDosing({
      age: num('e-age'),
      heightCm: num('e-height'),
      tbw: num('e-tbw'),
      scr: num('e-scr'),
      sexMale: document.querySelector('input[name="e-sex"]:checked').value === 'M',
      criticallyIll: $('e-icu').checked,
      targetAuc,
      clModel,
    });

    const icu = $('e-icu').checked;
    const crass = r.clModel === 'crass';

    // 臨床聲明（無法自動偵測）→ safety 層（唯一安全判斷來源）
    const declareE = {
      declaredAKI: $('e-aki').checked,
      pregnant: $('e-preg').checked,
      cysticFibrosis: $('e-cf').checked,
    };
    const sfE = SAFETY.buildSafetyMessages({
      mode: 1,
      eligibility: Object.assign({ age: num('e-age') }, declareE),
      dataQuality: { input: {}, mode: 1 },
      // 註：Mode 1 的預測 AUC 刻意不送入 classifyAUC——經驗起始必須給起始劑量，
      // 若因四捨五入落在 600 邊界而封鎖，臨床上更不安全。判讀僅供顯示。
    });
    const sex = document.querySelector('input[name="e-sex"]:checked').value === 'M' ? '男' : '女';

    // 第一層：臨床摘要（結論先於數據）。攤平邏輯在 viewmodel.js（純函式、可單測）。
    const viewE = VIEWMODEL.buildEmpiricViewModel({
      r, targetAuc, icu, declared: declareE,
      demo: { age: num('e-age'), sexLabel: sex, tbw: num('e-tbw'), heightCm: num('e-height'), scr: num('e-scr') },
    });
    const clLabel = viewE.technical.clLabel, loadLabel = viewE.technical.loadLabel;
    const sumE = SUMMARY.buildClinicalSummary(viewE, sfE, 1);
    renderSummary($('e-summary'), sumE);
    planText.e = SUMMARY.buildClinicalPlan(sumE);
    techText.e = SUMMARY.buildTechnicalReport(viewE, sfE, 1);
    $('e-tech').textContent = techText.e;

    // 第三層：進階 PK
    $('e-output').innerHTML =
      metric('Cockcroft-Gault CrCl', fmt(r.crcl, 0), 'mL/min', true) +
      metric('BMI', fmt(r.bmi, 1), 'kg/m²') +
      metric(clLabel, fmt(r.clPop, 2), 'L/h') +
      metric('IBW / CrCl 用體重', `${fmt(r.ibw, 1)} / ${fmt(r.crclWeight.weight, 1)}`, 'kg') +
      (icu ? metric(loadLabel, r.loadingDose + (r.loadingCapped ? '✱' : ''), 'mg', true) : '') +
      metric('理想日劑量 (目標)', fmt(r.tddTarget, 0), 'mg/day') +
      metric('建議維持 (圓整)', `${r.maintenanceDose} q${r.maintenanceInterval}h`, `＝${fmt(r.maintenanceDailyMg, 0)}/day`, true) +
      metric(`預測 AUC₂₄（目標 ${targetAuc}）`, fmt(r.predictedAuc24, 0), 'mg·h/L', true) +
      metric('預測峰 / 谷', `${fmt(r.predictedPeak, 1)} / ${fmt(r.predictedTrough, 1)}`, 'mg/L') +
      (crass && r.nomogram ? metric('Crass nomogram 對照', `${r.nomogram.maint} q${r.nomogram.tau}h`, `CLV≈${r.nomogram.clv}、負荷 ${r.nomogram.load}`) : '');
    // Mode 1 不收 tInf，故僅陳述建議區間。峰/谷固定以 EMPIRIC_TINF_H 預測，
    // 若實際依此建議延長輸注，真實峰值會略低於顯示值——如實揭露，不動已交叉驗證的算式。
    $('e-infusion').innerHTML = infusionHintHTML(infusionReqText([
      { label: '負荷', dose: icu ? r.loadingDose : 0 },
      { label: '維持', dose: r.maintenanceDose },
    ], `峰/谷預測固定假設輸注 ${VANCO.EMPIRIC_TINF_H}h；延長輸注後實際峰值略低、AUC 不變`));

    // 第四層：完整警示
    const extra = [];
    if (crass) extra.push({ level: 'info', msg: `肥胖 CL 模型（Crass 2018）：維持 TDD=目標AUC×CLV、負荷採 nomogram（less is more）；CrCl 體重採「${r.crclWeight.label}」。` });
    else extra.push({ level: 'info', msg: `CrCl 體重採「${r.crclWeight.label}」；負荷 mg/kg 用 TBW，維持以族群 CL 反推目標 AUC。` });
    if (r.loadingCapped) extra.push({ level: 'info', msg: '✱ 負荷已封頂於 3000 mg。' });
    renderWarnings($('e-warnings'), extra.concat(safetyWarnings(sfE), r.warnings));

    show('e');
  });
  wireCopy('e-copy-clinical', () => planText.e);
  wireCopy('e-copy-tech', () => techText.e);
  // 滑桿即時顯示目標 AUC 值
  $('e-target').addEventListener('input', () => { $('e-target-val').textContent = $('e-target').value; });
  // CL 模型即時提示：BMI≥30 建議 Crass、<30 建議 Matzke
  function updateClModelHint() {
    const h = num('e-height'), w = num('e-tbw');
    const sel = document.querySelector('input[name="e-clmodel"]:checked').value;
    const hint = $('e-clmodel-hint');
    hint.style.color = '';
    if (isFinite(h) && h > 0 && isFinite(w) && w > 0) {
      const bmi = w / Math.pow(h / 100, 2);
      if (bmi >= 30 && sel === 'matzke') { hint.textContent = `BMI ${bmi.toFixed(1)} → 建議 Crass`; hint.style.color = 'var(--color-amber)'; return; }
      if (bmi < 30 && sel === 'crass') { hint.textContent = `BMI ${bmi.toFixed(1)} < 30 → 建議 Matzke`; hint.style.color = 'var(--color-amber)'; return; }
    }
    hint.textContent = sel === 'crass' ? '肥胖族群' : '一般族群';
  }
  ['e-height', 'e-tbw'].forEach((id) => $(id).addEventListener('input', updateClModelHint));
  document.querySelectorAll('input[name="e-clmodel"]').forEach((el) => el.addEventListener('change', updateClModelHint));

  // ---------- Mode 2：雙點反算 ----------
  $('a-calc').addEventListener('click', () => {
    const ids = ['a-dose', 'a-tau', 'a-tinf', 'a-c1', 'a-t1', 'a-c2', 'a-t2'];
    const bad = ids.filter((id) => !isFinite(num(id)));
    markError(ids, false); markError(bad, true);
    if (bad.length) { alertResult('a', '請完整填入給藥方案與兩點濃度。'); return; }

    const mic = isFinite(num('a-mic')) && num('a-mic') > 0 ? num('a-mic') : VANCO.MIC_DEFAULT;
    const input = {
      dose: num('a-dose'), tau: num('a-tau'), tInf: num('a-tinf'),
      c1: num('a-c1'), t1: num('a-t1'), c2: num('a-c2'), t2: num('a-t2'), mic,
    };
    const r = PK.twoLevelAUC(input);

    if (!r.ok) {
      // 反算失敗即無個人化 PK，殘留的 simCtx 會讓自訂試算沿用上一位病人的參數
      simCtx = null; planACustom = null; $('sim-out').innerHTML = '';
      alertResult('a', r.errors, [
        '請確認兩點濃度與其採血時刻（t 以最近一劑起始為 0）、輸注時長與給藥間隔。',
        '確認峰／谷未填反、且第一點落在輸注結束之後再重新計算。',
      ]);
      return;
    }

    // PK 參數（第三層）
    $('a-pk').innerHTML =
      metric('預測峰值 (真峰)', fmt(r.cMaxTrue, 1), 'mg/L') +
      metric('預測谷值 (真谷)', fmt(r.cMinTrue, 1), 'mg/L') +
      metric('ke', fmt(r.ke, 4), '/h') +
      metric('半衰期 t½', fmt(r.halfLife, 1), 'h') +
      metric('Vd', fmt(r.vd, 1), 'L') +
      metric('清除率 CL', fmt(r.cl, 2), 'L/h') +
      metric('AUC/MIC', fmt(r.aucOverMic, 0), `MIC ${mic}`);
    $('a-infusion').innerHTML = infusionHintHTML(infusionWarnText(input.dose, input.tInf));

    // 間隔劑量表（AUC 由每日總量決定、各間隔相同；差異在峰/谷。標記與輸入 τ 相同的列）
    const rows = r.intervalOptions.map((o) => {
      const rec = o.intervalH === input.tau;
      const inRange = o.projectedAuc24 >= VANCO.AUC_TARGET_MIN && o.projectedAuc24 <= VANCO.AUC_TARGET_MAX;
      const doseCell = o.impractical ? `${o.doseMg}<span title="單次過大，建議縮短間隔">⚠</span>` : o.doseMg;
      return `<tr class="${rec ? 'is-recommended' : ''}">
        <td>q${o.intervalH}h</td>
        <td>${doseCell}</td>
        <td>${o.dailyMg}</td>
        <td>${fmt(o.projectedPeak, 1)}</td>
        <td>${fmt(o.projectedTrough, 1)}</td>
        <td style="color:${inRange ? 'var(--color-green)' : 'var(--color-amber)'}">${fmt(o.projectedAuc24, 0)}</td>
      </tr>`;
    }).join('');
    $('a-table').innerHTML =
      `<thead><tr><th>間隔</th><th>每次 (mg)</th><th>每日 (mg)</th><th>峰 (mg/L)</th><th>谷 (mg/L)</th><th>預估 AUC₂₄</th></tr></thead><tbody>${rows}</tbody>`;

    // 臨床聲明（無法自動偵測）
    const declareA = {
      declaredAKI: $('a-aki').checked,
      declaredUnreliableDoseTiming: $('a-dosetime').checked,
      declaredUnreliableSampleTiming: $('a-sampletime').checked,
      pregnant: $('a-preg').checked,
      cysticFibrosis: $('a-cf').checked,
    };
    // Safety 層（eligibility 聲明 + 分布相取樣分級 + AUC 分級）——唯一安全判斷來源。
    // AUC 一併送入 classifyAUC，使「AUC>600 不出單行減量建議」由 safety 決定，
    // 不在 UI 另寫一份 aucHigh 規則。
    const sf = SAFETY.buildSafetyMessages({
      mode: 2,
      eligibility: declareA,
      concentrations: {
        levels: { c1: input.c1, t1: input.t1, c2: input.c2, t2: input.t2 },
        dosing: { tau: input.tau, tInf: input.tInf },
        pk: { ke: r.ke, halfLife: r.halfLife, auc24: r.auc24 },
      },
      auc: r.auc24,
    });

    // 主推薦方案：維持原間隔（沿用既有挑法，不新增模型）
    const recOpt = r.intervalOptions.find((o) => o.intervalH === input.tau) || r.intervalOptions[1];
    const viewA = VIEWMODEL.buildTwoLevelViewModel({ r, input, recOpt, declared: declareA });
    const sumA = SUMMARY.buildClinicalSummary(viewA, sf, 2);
    renderSummary($('a-summary'), sumA);

    // 第二層標題／註記：閘門關閉時，候選劑量僅為外推參考，不可直接採用
    const caveatEl = $('a-rec-caveat');
    if (sumA.blocked) {
      $('a-alt-layer').classList.add('layer--warn');
      $('a-alt-title').textContent = '外推參考（本案不可直接採用）— 其他間隔與預估暴露量';
      caveatEl.hidden = false;
      caveatEl.textContent = `⚠️ ${sumA.blockedReasons.join('；')}：下表為線性外推的維持劑量，`
        // 不可在此宣稱「量測 AUC 仍有效」：採血時間不可靠時 safety 已明寫該 AUC 不可信，
        // 兩句會同屏互斥。保留顯示 ≠ 宣稱有效。
        + '本案不可直接採用，須先處理上述問題並以重複濃度重新評估。'
        + '上方量測 AUC₂₄ 仍照原樣顯示，其可靠度以上述成因為準。';
    } else {
      $('a-alt-layer').classList.remove('layer--warn');
      $('a-alt-title').textContent = '替代方案（其他間隔與預估暴露量）';
      caveatEl.hidden = true; caveatEl.textContent = '';
    }

    // 第四層：完整警示（safety 全訊息 + 領域補充）
    renderWarnings($('a-warnings'), safetyWarnings(sf).concat(r.warnings));

    // 計算式明細（第三層）——與技術完整版共用同一份字串，不兩處各寫一次
    $('a-formula').textContent = viewA.technical.formula;

    // 自訂試算：存個人化 PK + 兩版文字所需狀態
    simCtx = {
      mode: 2, ke: r.ke, vd: r.vd, cl: r.cl, mic, tInf: r.tInf,
      view: viewA, safety: sf,
    };
    planACustom = null;
    rebuildTextsA();
    $('sim-dose').value = recOpt.doseMg;
    $('sim-tau').value = recOpt.intervalH;
    $('sim-out').innerHTML = '';

    show('a');
  });
  wireCopy('a-copy-clinical', () => planText.a);
  wireCopy('a-copy-tech', () => techText.a);
  wireCopy('a-copy-alt', () => altText.a);

  // Mode 2 兩版可複製文字。自訂選定方案只補在文末附註，不改動摘要的主要推薦
  // （避免使用者的 what-if 被誤讀為系統建議）。附註的分版規則見 SUMMARY.customSimulationNote：
  // BLOCK 時臨床簡版不得帶任何具體劑量——此處不得再自行拼接。
  let planACustom = null;
  function rebuildTextsA() {
    const s = simCtx; if (!s || s.mode !== 2) return;
    const sum = SUMMARY.buildClinicalSummary(s.view, s.safety, 2);
    planText.a = SUMMARY.appendCustomSimulation(
      SUMMARY.buildClinicalPlan(sum), planACustom, sum, 'clinical');
    techText.a = SUMMARY.appendCustomSimulation(
      SUMMARY.buildTechnicalReport(s.view, s.safety, 2), planACustom, sum, 'technical');
    altText.a = SUMMARY.buildExtrapolationSummary(sum, planACustom);
    syncAltCopy('a', sum.blocked);
    $('a-tech').textContent = techText.a;
  }
  /** 輸注速率過快時的附註文字（給藥安全，與 AUC 無關）。 */
  function rateNoteText(dose, tInf) {
    return infusionWarnText(dose, tInf)
      ? `輸注速率過快：${dose} mg 建議輸注 ${advisedInfText(dose)}（10–15 mg/min，或 1g/60min）。`
      : '';
  }

  // 自訂方案試算
  function renderSim() {
    if (!simCtx) return;
    const dose = num('sim-dose'), tau = num('sim-tau');
    if (!(dose > 0) || !(tau > 0)) {
      $('sim-out').innerHTML = '<div class="alert alert--error"><span>⛔</span><span>請輸入有效的劑量與間隔。</span></div>';
      return;
    }
    const s = PK.simulateRegimen(dose, tau, simCtx.tInf, simCtx.ke, simCtx.vd, simCtx.cl, simCtx.mic);
    const st = SUMMARY.classifyDisplay(s.auc24), tag = SUMMARY.displayTag(s.auc24);
    $('sim-out').innerHTML =
      '<div class="sim-result">' +
      metric('預測峰值', fmt(s.peak, 1), 'mg/L') +
      metric('預測谷值', fmt(s.trough, 1), 'mg/L') +
      metric('AUC₂₄', fmt(s.auc24, 0), 'mg·h/L', true) +
      metric('AUC/MIC', fmt(s.aucOverMic, 0), '') +
      metric('日劑量', fmt(s.dailyMg, 0), 'mg') +
      '</div>' +
      `<span class="sim-badge sim-badge--${st}">AUC ${tag}（目標 ${VANCO.AUC_TARGET_MIN}–${VANCO.AUC_TARGET_MAX}）</span>` +
      (s.impractical ? ' <span class="sim-badge sim-badge--high">⚠ 單次劑量過大</span>' : '') +
      infusionHintHTML(infusionWarnText(dose, simCtx.tInf));
    // 帶入 Plan：自訂選定方案
    planACustom = {
      dose, tau, dailyMg: s.dailyMg, peak: s.peak, trough: s.trough, auc24: s.auc24, tag,
      rateNote: rateNoteText(dose, simCtx.tInf),
    };
    rebuildTextsA();
  }
  $('sim-calc').addEventListener('click', renderSim);
  ['sim-dose', 'sim-tau'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') renderSim(); }));

  // ---------- Mode 3：Bayesian MAP ----------
  function levelRow(i) {
    const cPh = i === 1 ? '15' : '25';
    const tPh = i === 1 ? '11.5' : '2';
    return `<div class="form-grid levels__row" id="b-row-${i}">
      <div class="field">
        <label class="field__label" for="b-c${i}">濃度 ${i} <span class="field__unit">mg/L</span></label>
        <input class="field__input" type="number" id="b-c${i}" min="0.1" step="0.1" placeholder="${cPh}">
      </div>
      <div class="field">
        <label class="field__label" for="b-t${i}">時刻 ${i} <span class="field__unit">h（距最近一劑）</span></label>
        <input class="field__input" type="number" id="b-t${i}" min="0" step="0.1" placeholder="${tPh}">
      </div>
      ${i === 2 ? '<button class="btn btn--sim levels__del" id="b-del-2" type="button">✕ 移除</button>' : ''}
    </div>`;
  }
  (function initBayesLevels() {
    if (!$('b-levels')) return;
    $('b-levels').innerHTML = levelRow(1) + levelRow(2);
    $('b-row-2').style.display = 'none';
    $('b-add').addEventListener('click', () => {
      $('b-row-2').style.display = '';
      $('b-add').style.display = 'none';
    });
    $('b-del-2').addEventListener('click', () => {
      $('b-row-2').style.display = 'none';
      $('b-add').style.display = '';
      $('b-c2').value = ''; $('b-t2').value = '';
      markError(['b-c2', 'b-t2'], false);
    });
  })();
  $('b-target') && $('b-target').addEventListener('input', () => { $('b-target-val').textContent = $('b-target').value; });

  function alertBayes(msg, steps) {
    const msgs = [].concat(msg).filter(Boolean);
    $('b-pk').innerHTML = ''; $('b-fit').innerHTML = '';
    $('b-formula').innerHTML = ''; $('b-tech').textContent = ''; $('b-infusion').innerHTML = '';
    planText.b = ''; techText.b = '';
    altText.b = ''; syncAltCopy('b', true);
    renderSummary($('b-summary'), SUMMARY.buildFatalSummary(msgs, steps, 3));
    renderWarnings($('b-warnings'), msgs.map((m) => ({ level: 'error', msg: m })));
    show('b');
  }

  $('b-calc') && $('b-calc').addEventListener('click', () => {
    const baseIds = ['b-age', 'b-height', 'b-tbw', 'b-scr', 'b-dose', 'b-tau', 'b-tinf', 'b-ndose'];
    const bad = baseIds.filter((id) => !isFinite(num(id)) || num(id) <= 0);
    markError(baseIds, false); markError(bad, true);
    if (bad.length) { alertBayes('請完整填入病人資料與現行給藥方案（數值須 > 0）。'); return; }
    if (num('b-age') < 18) { markError(['b-age'], true); alertBayes('本工具僅適用成人（≥18 歲）。'); return; }

    // 濃度點（1–2）
    const l2on = $('b-row-2').style.display !== 'none';
    const idxs = l2on ? [1, 2] : [1];
    const levels = []; let levelBad = false;
    markError(['b-c1', 'b-t1', 'b-c2', 'b-t2'], false);
    idxs.forEach((i) => {
      const c = num('b-c' + i), t = num('b-t' + i);
      if (isFinite(c) && c > 0 && isFinite(t) && t >= 0) levels.push({ conc: c, tRel: t });
      else { levelBad = true; markError(['b-c' + i, 'b-t' + i], true); }
    });
    if (!levels.length || levelBad) { alertBayes('請至少填入 1 點有效濃度（濃度 > 0、時刻 ≥ 0）。'); return; }

    const tau = num('b-tau'), tInf = num('b-tinf'), dose = num('b-dose'), N = Math.round(num('b-ndose'));
    const sexMale = document.querySelector('input[name="b-sex"]:checked').value === 'M';
    const dialysis = $('b-dial').checked;
    // 臨床聲明（無法自動偵測，由使用者勾選）
    const declare = {
      declaredAKI: $('b-aki').checked,
      declaredUnreliableDoseTiming: $('b-dosetime').checked,
      declaredUnreliableSampleTiming: $('b-sampletime').checked,
      pregnant: $('b-preg').checked,
      cysticFibrosis: $('b-cf').checked,
    };
    const mic = isFinite(num('b-mic')) && num('b-mic') > 0 ? num('b-mic') : VANCO.MIC_DEFAULT;
    const targetAuc = num('b-target') || VANCO.AUC_TARGET_DEFAULT;

    // CrCL 用體重（沿用 Mode 1 選用：消瘦 TBW / 肥胖 AdjBW）
    const ibw = PK.idealBodyWeight(sexMale, num('b-height'));
    const cw = PK.crclDosingWeight(num('b-tbw'), ibw);

    // 給藥史：N 劑於 0,τ,…,(N−1)τ；濃度絕對時刻 = 最近一劑起始 + tRel
    const doses = []; for (let i = 0; i < N; i++) doses.push({ time: i * tau, dose, tInf });
    const lastStart = (N - 1) * tau;
    const obs = levels.map((l) => ({ time: lastStart + l.tRel, conc: l.conc }));

    const r = BAYES.bayesianMAP({
      cov: { age: num('b-age'), weightKg: cw.weight, scr: num('b-scr'), sexMale, dialysis },
      tbw: num('b-tbw'), doses, obs, currentDailyDose: dose * (24 / tau),
    });

    // ---- Safety 層：BLOCK 守衛 + 穩態判定 + 劑量建議閘門 ----
    // 有效半衰期（0.693×Vss/CL，偏保守）；達 4 個半衰期視為近穩態
    const tHalfEff = 0.693 * r.vss / r.cl;
    const elapsedToLast = lastStart + Math.max.apply(null, levels.map((l) => l.tRel));
    const steadyState = isFinite(tHalfEff) && elapsedToLast >= 4 * tHalfEff;

    const sf = SAFETY.buildSafetyMessages({
      eligibility: Object.assign({ age: num('b-age'), dialysis }, declare),
      dataQuality: { input: { nLevels: levels.length, steadyState }, mode: 3 },
      bayesFit: r,
      auc: r.auc24Current,
    });

    // optimizer 未收斂 / 多起點不一致 / 非有限輸出 → 不吐貌似合理的數字
    if (!sf.allowCalculation) {
      alertBayes(sf.messages.filter((m) => m.severity === 'block').map((m) => m.text), [
        '請確認給藥史（劑次、間隔、輸注時長）與採血時刻是否正確輸入。',
        '資料無誤仍無法擬合時，改以雙點反算評估，或重新採樣後再計算。',
      ]);
      return;
    }
    const canRecommend = sf.allowDoseRecommendation;
    const auc = r.auc24Current;

    // 個體 PK（第三層）
    const shrink = (eta) => `${eta >= 0 ? '+' : ''}${(eta * 100).toFixed(0)}%`;
    $('b-pk').innerHTML =
      metric('Cockcroft-Gault CrCl', fmt(r.crcl, 0), 'mL/min') +
      metric('個體 CL', fmt(r.cl, 2), 'L/h', true) +
      metric('先驗 CL → 個體', `${fmt(r.prior.cl, 2)} → ${fmt(r.cl, 2)}`, `η ${shrink(r.eta.cl)}`) +
      metric('中央室 Vc', fmt(r.vc, 1), 'L') +
      metric('周邊室 Vp', fmt(r.vp, 1), 'L') +
      metric('穩態分布體積 Vss', fmt(r.vss, 1), 'L') +
      metric('AUC/MIC', fmt(auc / mic, 0), `MIC ${mic}`);
    $('b-infusion').innerHTML = infusionHintHTML(infusionWarnText(dose, tInf)); // 現行方案

    // 擬合檢核
    const fitRows = r.predictedAtObs.map((p, i) => {
      const d = p.predicted - p.observed;
      return `<tr><td>第 ${i + 1} 點 (t=${fmt(levels[i].tRel, 1)}h)</td>
        <td>${fmt(p.observed, 1)}</td><td>${fmt(p.predicted, 1)}</td>
        <td style="color:${Math.abs(d) <= 3 ? 'var(--color-green)' : 'var(--color-amber)'}">${d >= 0 ? '+' : ''}${fmt(d, 1)}</td></tr>`;
    }).join('');
    $('b-fit').innerHTML =
      `<thead><tr><th>採血點</th><th>實測 (mg/L)</th><th>模型預測</th><th>差值</th></tr></thead><tbody>${fitRows}</tbody>`;

    // 建議劑量（同間隔達目標 AUC）——數值一律算出，是否呈現由 summary 依 safety 決定
    const recTDD = r.recommendTDD(targetAuc);
    const recDose = PK.roundDose(recTDD * (tau / 24), 250);
    const recExp = BAYES.steadyStateExposure(recDose, tau, tInf, { cl: r.cl, vc: r.vc, vp: r.vp, q: r.q });
    // 現行方案的穩態暴露（達標時摘要顯示「維持現行」需要峰/谷）
    const curExp = BAYES.steadyStateExposure(dose, tau, tInf, { cl: r.cl, vc: r.vc, vp: r.vp, q: r.q });

    // 第一層：臨床摘要。攤平邏輯在 viewmodel.js（純函式、可單測）。
    const sex = sexMale ? '男' : '女';
    const viewB = VIEWMODEL.buildBayesViewModel({
      r, dose, tau, tInf, nDose: N, levels, steadyState, mic, targetAuc,
      recDose, recExp, curExp, declared: declare,
      demo: {
        age: num('b-age'), sexLabel: sex, tbw: num('b-tbw'),
        heightCm: num('b-height'), scr: num('b-scr'), dialysis,
      },
    });
    const sumB = SUMMARY.buildClinicalSummary(viewB, sf, 3);
    renderSummary($('b-summary'), sumB);

    // 第四層：完整警示（safety 全訊息 + 領域補充）
    const w = safetyWarnings(sf);
    if (levels.some((l) => l.tRel < tInf)) w.push({ level: 'info', msg: '有採血點落在輸注期內（分布相）：二室 Bayesian 可處理，此為相對雙點法的優勢。' });
    if (mic >= VANCO.MIC_ALT_AGENT) w.push({ level: 'warn', msg: `MIC ≥ ${VANCO.MIC_ALT_AGENT} mg/L：傳統劑量難達 AUC/MIC ≥400，考慮換藥。` });
    w.push({ level: 'info', msg: '先驗模型：Goti 2018（住院成人）。重症病人先驗精度較低（Narayan 2021）；本估計須臨床覆核。' });
    renderWarnings($('b-warnings'), w);

    // 自訂試算：存 MAP 個體 PK + 兩版文字所需狀態
    bSimCtx = {
      pk: { cl: r.cl, vc: r.vc, vp: r.vp, q: r.q },
      dose, tau, mic, view: viewB, safety: sf,
    };
    planBCustom = null;
    rebuildTextsB();
    renderBSimCaveat();
    // 預填：可建議時帶入建議方案，否則沿用現行方案（讓使用者從現況起改）
    $('b-sim-dose').value = canRecommend ? recDose : dose;
    $('b-sim-tau').value = tau;
    $('b-sim-tinf').value = tInf;
    $('b-sim-out').innerHTML = '';

    // 模型細節——與技術完整版共用同一份字串
    $('b-formula').textContent = viewB.technical.formula;

    show('b');
  });
  wireCopy('b-copy-clinical', () => planText.b);
  wireCopy('b-copy-tech', () => techText.b);
  wireCopy('b-copy-alt', () => altText.b);

  // Mode 3 兩版可複製文字；自訂試算只作為附註補在文末
  let planBCustom = null;
  function rebuildTextsB() {
    const s = bSimCtx; if (!s) return;
    const sum = SUMMARY.buildClinicalSummary(s.view, s.safety, 3);
    planText.b = SUMMARY.appendCustomSimulation(
      SUMMARY.buildClinicalPlan(sum), planBCustom, sum, 'clinical');
    techText.b = SUMMARY.appendCustomSimulation(
      SUMMARY.buildTechnicalReport(s.view, s.safety, 3), planBCustom, sum, 'technical');
    altText.b = SUMMARY.buildExtrapolationSummary(sum, planBCustom);
    syncAltCopy('b', sum.blocked);
    $('b-tech').textContent = techText.b;
  }

  // 閘門關閉時，自訂試算仍照常投影（使用者主動指定的 what-if），但須標明其不可靠成因。
  // 成因一律取自 summary（其來源為 safety verdict），不在此另寫一套條件。
  function renderBSimCaveat() {
    const el = $('b-sim-caveat'); const s = bSimCtx;
    const sum = s ? SUMMARY.buildClinicalSummary(s.view, s.safety, 3) : null;
    if (!sum || !sum.blocked) {
      el.hidden = true; el.textContent = '';
      $('b-alt-layer').classList.remove('layer--warn');
      $('b-alt-title').textContent = '替代方案（自訂試算，以本次 MAP 個體 PK 二室模擬）';
      return;
    }
    el.hidden = false;
    $('b-alt-layer').classList.add('layer--warn');
    $('b-alt-title').textContent = '外推參考（本案不可直接採用）— 自訂試算';
    el.textContent = `⚠️ ${sum.blockedReasons.join('；')}。下方試算為「你指定方案」的模型投影，`
      + '不等於本工具的劑量建議，須以重複濃度重新評估後再決定。';
  }

  // Mode 3 自訂方案試算：用 MAP 個體 PK 跑二室穩態模擬（非 Mode 2 的一室 first-order）
  function renderBSim() {
    if (!bSimCtx) return;
    const dose = num('b-sim-dose'), tau = num('b-sim-tau'), tInf = num('b-sim-tinf');
    if (!(dose > 0) || !(tau > 0) || !(tInf > 0)) {
      $('b-sim-out').innerHTML = '<div class="alert alert--error"><span>⛔</span><span>請輸入有效的劑量、間隔與輸注時長（皆須 > 0）。</span></div>';
      return;
    }
    if (tInf > tau) {
      $('b-sim-out').innerHTML = '<div class="alert alert--error"><span>⛔</span><span>輸注時長不可超過給藥間隔（否則為持續輸注，本工具未涵蓋）。</span></div>';
      return;
    }
    const e = BAYES.steadyStateExposure(dose, tau, tInf, bSimCtx.pk);
    if (!isFinite(e.auc24) || !isFinite(e.peak) || !isFinite(e.trough)) {
      $('b-sim-out').innerHTML = '<div class="alert alert--error"><span>⛔</span><span>模擬產生非有限值，無法輸出。請檢查輸入。</span></div>';
      return;
    }
    const dailyMg = dose * (24 / tau);
    const st = SUMMARY.classifyDisplay(e.auc24), tag = SUMMARY.displayTag(e.auc24);
    $('b-sim-out').innerHTML =
      '<div class="sim-result">' +
      metric('穩態峰值 (輸注末)', fmt(e.peak, 1), 'mg/L') +
      metric('穩態谷值 (間隔末)', fmt(e.trough, 1), 'mg/L') +
      metric('AUC₂₄', fmt(e.auc24, 0), 'mg·h/L', true) +
      metric('AUC/MIC', fmt(e.auc24 / bSimCtx.mic, 0), `MIC ${bSimCtx.mic}`) +
      metric('日劑量', fmt(dailyMg, 0), 'mg') +
      '</div>' +
      `<span class="sim-badge sim-badge--${st}">AUC ${tag}（目標 ${VANCO.AUC_TARGET_MIN}–${VANCO.AUC_TARGET_MAX}）</span>` +
      (dose > VANCO.MAINT_PERDOSE_PRACTICAL_MAX ? ' <span class="sim-badge sim-badge--high">⚠ 單次劑量過大</span>' : '');
    // 輸注速率小提示（給藥安全；不影響上列 AUC，故不混入 AUC badge、不升級為 alert）
    $('b-sim-out').insertAdjacentHTML('beforeend', infusionHintHTML(infusionWarnText(dose, tInf)));
    planBCustom = {
      dose, tau, tInf, dailyMg, peak: e.peak, trough: e.trough, auc24: e.auc24, tag,
      rateNote: rateNoteText(dose, tInf),
    };
    rebuildTextsB();
  }
  $('b-sim-calc') && $('b-sim-calc').addEventListener('click', renderBSim);
  ['b-sim-dose', 'b-sim-tau', 'b-sim-tinf'].forEach((id) => {
    $(id) && $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') renderBSim(); });
  });

  // ---------- 顯示 / 錯誤 ----------
  function show(prefix) {
    const el = $(prefix + '-result');
    el.hidden = false;
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  // 失敗時的訊息必須留在第一層（§八.8）。第四層 <details> 預設收合，
  // 只寫進去等於使用者按下計算後什麼都看不到——v0.5.0 曾發生此迴歸。
  function alertResult(prefix, msg, steps) {
    const msgs = [].concat(msg).filter(Boolean);
    $(prefix + '-tech').textContent = '';
    $(prefix + '-infusion').innerHTML = '';
    planText[prefix] = ''; techText[prefix] = '';
    altText[prefix] = ''; syncAltCopy(prefix, true);
    if (prefix === 'e') { $('e-output').innerHTML = ''; }
    else { $('a-pk').innerHTML = ''; $('a-table').innerHTML = ''; $('a-formula').innerHTML = ''; }
    renderSummary($(prefix + '-summary'),
      SUMMARY.buildFatalSummary(msgs, steps, prefix === 'e' ? 1 : 2));
    renderWarnings($(prefix + '-warnings'), msgs.map((m) => ({ level: 'error', msg: m })));
    show(prefix);
  }
})();
