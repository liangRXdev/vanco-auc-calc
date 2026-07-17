/* ui.js — DOM 綁定：讀輸入 → 呼叫 PK → 渲染結果 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const num = (id) => parseFloat($(id).value);
  const fmt = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '—');
  let simCtx = null;  // Mode 2：最近一次反算的個人化 PK，供自訂試算沿用
  let bSimCtx = null; // Mode 3：最近一次 MAP 的個體 PK（二室），供自訂試算沿用

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
  function metric(label, value, unit, primary) {
    return `<div class="metric${primary ? ' metric--primary' : ''}">
      <div class="metric__label">${label}</div>
      <div class="metric__value">${value}<span class="metric__unit">${unit || ''}</span></div>
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
  // 資料信心 badge（三模式共用）：tier 由 safety verdict 合併得出（L2 shrinkage 背書）
  function renderConfidence(el, verdict, reasons, baseNote) {
    const tier = verdict.confidence; // High / Moderate / Low / Invalid
    const cls = tier === 'High' ? 'high' : tier === 'Moderate' ? 'moderate' : 'low';
    const rs = (reasons || []).filter(Boolean);
    const note = rs.length ? `影響因子：${rs.join('、')}` : baseNote;
    el.innerHTML =
      `<span class="confidence__badge confidence__badge--${cls}">資料信心：${tier}</span>` +
      `<span class="confidence__note">${esc(note)}</span>`;
  }
  // AUC>600 結構化處置卡片（取代單行減量建議）
  function managementCardHTML(title) {
    const items = SAFETY.auc600Management().map((s) => `<li>${esc(s)}</li>`).join('');
    return `<div class="alert alert--error" style="display:block">
      <b>⛔ ${esc(title)}</b>
      <ol style="margin:.5rem 0 0 1.25rem;padding:0;line-height:1.7">${items}</ol></div>`;
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
    const clLabel = crass ? '族群 CLV (Crass 肥胖)' : '族群 CLvanco (Matzke)';
    const loadLabel = crass ? '負荷劑量 (nomogram)' : '負荷劑量 (TBW)';
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
    // 臨床聲明（無法自動偵測）+ 資料信心（經驗＝無實測濃度，本質 Moderate；AKI 降 Low）
    const declareE = {
      declaredAKI: $('e-aki').checked,
      pregnant: $('e-preg').checked,
      cysticFibrosis: $('e-cf').checked,
    };
    const sfE = SAFETY.buildSafetyMessages({
      mode: 1,
      eligibility: Object.assign({ age: num('e-age') }, declareE),
      dataQuality: { input: {}, mode: 1 },
    });
    renderConfidence($('e-confidence'), sfE, [
      declareE.declaredAKI && 'AKI', declareE.pregnant && '懷孕', declareE.cysticFibrosis && 'CF',
    ], '經驗起始（無實測濃度）→ 須及早採濃度驗證');

    const extra = [];
    if (crass) extra.push({ level: 'info', msg: `肥胖 CL 模型（Crass 2018）：維持 TDD=目標AUC×CLV、負荷採 nomogram（less is more）；CrCl 體重採「${r.crclWeight.label}」。` });
    else extra.push({ level: 'info', msg: `CrCl 體重採「${r.crclWeight.label}」；負荷 mg/kg 用 TBW，維持以族群 CL 反推目標 AUC。` });
    if (r.loadingCapped) extra.push({ level: 'info', msg: '✱ 負荷已封頂於 3000 mg。' });
    // 聲明產生的 warn（AKI/懷孕/CF）併入；info 級（DQ_EMPIRIC）已由信心 badge 表達，不重複
    const eligWarns = safetyWarnings(sfE).filter((w) => w.level !== 'info');
    renderWarnings($('e-warnings'), extra.concat(eligWarns, r.warnings));

    // Plan（可複製）：僅行動，病人/腎功能/判讀見 Assessment
    const sex = document.querySelector('input[name="e-sex"]:checked').value === 'M' ? '男' : '女';
    const lines = [`【Vancomycin 起始劑量 Plan】${crass ? '（Crass 肥胖 CL 模型）' : ''}`];
    if (icu) lines.push(`負荷：${r.loadingDose} mg IV（${crass ? 'Crass nomogram' : 'TBW'}）${r.loadingCapped ? '（已封頂 3000mg）' : ''}`);
    lines.push(
      `維持：${r.maintenanceDose} mg IV q${r.maintenanceInterval}h（${fmt(r.maintenanceDailyMg, 0)} mg/day）→ 預測 AUC24 ≈ ${fmt(r.predictedAuc24, 0)}（目標 ${targetAuc}）、峰/谷 ${fmt(r.predictedPeak, 1)}/${fmt(r.predictedTrough, 1)}`,
      '監測：24–48h 內採雙點濃度驗證 AUC 後調整。',
      '本工具僅供輔助，須專業覆核。'
    );
    $('e-plan').textContent = lines.join('\n');

    // 評估 Assessment（SOAP-A：臨床判讀）
    const eObese = num('e-tbw') > CG.OBESE_TBW_OVER_IBW * r.ibw;
    const eAucOk = r.predictedAuc24 >= VANCO.AUC_TARGET_MIN && r.predictedAuc24 <= VANCO.AUC_TARGET_MAX;
    const eA = [
      '【Vancomycin 評估 Assessment】（經驗起始，尚無血中濃度）',
      `病人：${num('e-age')}歲 ${sex}，${num('e-tbw')}kg / ${num('e-height')}cm（BMI ${fmt(r.bmi, 1)}），SCr ${num('e-scr')} mg/dL`,
      `腎功能：CrCl (Cockcroft-Gault，${r.crclWeight.label} ${fmt(r.crclWeight.weight, 1)}kg) = ${fmt(r.crcl, 0)} mL/min；${crass ? '肥胖 CLV (Crass)' : '族群 CL (Matzke)'} ${fmt(r.clPop, 2)} L/h`,
      `建議方案（${r.maintenanceDose} q${r.maintenanceInterval}h）預測 AUC₂₄ ≈ ${fmt(r.predictedAuc24, 0)}（目標 ${targetAuc}）→ ${eAucOk ? '達標' : '偏離，需檢視'}${crass && r.nomogram ? `；Crass nomogram 對照 ${r.nomogram.maint} q${r.nomogram.tau}h` : ''}`,
    ];
    if (icu) eA.push(`重症/嚴重 MRSA：已納入負荷 ${r.loadingDose} mg（${crass ? 'nomogram' : 'TBW'}）。`);
    if (eObese && !crass) eA.push('肥胖：Matzke 族群 CL 為粗估，建議切換 Crass 肥胖 CL 模型或儘早雙點驗證。');
    else if (eObese && crass) eA.push('肥胖：已採 Crass 肥胖 pop-PK（TBW allometric）；仍建議 24–48h 雙點驗證。');
    if (r.crcl < 30) eA.push('腎功能不全：間隔已延長，須密切監測。');
    const eReasons = [declareE.declaredAKI && 'AKI', declareE.pregnant && '懷孕', declareE.cysticFibrosis && 'CF'].filter(Boolean);
    eA.push(`資料信心：${sfE.confidence}（經驗起始，無實測濃度${eReasons.length ? '；' + eReasons.join('、') : ''}）`);
    eA.push('屬經驗估計，須 24–48h 內採濃度驗證。');
    $('e-assess').textContent = eA.join('\n');

    show('e');
  });
  wireCopy('e-assess-copy', () => $('e-assess').textContent);
  wireCopy('e-copy', () => $('e-plan').textContent);
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
      $('a-hero').innerHTML = '';
      $('a-pk').innerHTML = ''; $('a-table').innerHTML = ''; $('a-formula').innerHTML = '';
      renderWarnings($('a-warnings'), r.errors.map((m) => ({ level: 'error', msg: m })));
      show('a');
      return;
    }

    // AUC hero（狀態配色）
    const st = r.auc24 > VANCO.AUC_AKI_THRESHOLD ? 'high'
             : r.auc24 < VANCO.AUC_TARGET_MIN ? 'low' : 'ok';
    const tag = st === 'ok' ? '達標' : st === 'low' ? '偏低' : '偏高';
    $('a-hero').className = `auc-hero auc-hero--${st}`;
    $('a-hero').innerHTML =
      `<div><div class="auc-hero__num">${fmt(r.auc24, 0)}</div><div class="auc-hero__label">AUC₂₄ (mg·h/L)　目標 400–600</div></div>
       <div><div class="auc-hero__num">${fmt(r.aucOverMic, 0)}</div><div class="auc-hero__label">AUC/MIC（MIC ${mic}）</div></div>
       <span class="auc-hero__tag">${tag}</span>`;

    // PK 參數
    $('a-pk').innerHTML =
      metric('預測峰值 (真峰)', fmt(r.cMaxTrue, 1), 'mg/L') +
      metric('預測谷值 (真谷)', fmt(r.cMinTrue, 1), 'mg/L') +
      metric('ke', fmt(r.ke, 4), '/h') +
      metric('半衰期 t½', fmt(r.halfLife, 1), 'h') +
      metric('Vd', fmt(r.vd, 1), 'L') +
      metric('清除率 CL', fmt(r.cl, 2), 'L/h');

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
    // Safety 層（eligibility 聲明 + 分布相取樣分級 + AUC>600 處置）
    const sf = SAFETY.buildSafetyMessages({
      mode: 2,
      eligibility: declareA,
      concentrations: {
        levels: { c1: input.c1, t1: input.t1, c2: input.c2, t2: input.t2 },
        dosing: { tau: input.tau, tInf: input.tInf },
        pk: { ke: r.ke, halfLife: r.halfLife, auc24: r.auc24 },
      },
    });
    const aucHigh = r.auc24 > VANCO.AUC_AKI_THRESHOLD;

    // 資料信心 badge（eligibility + 取樣時相合併；量測 AUC 本質可信，聲明/分布相會降信心）
    renderConfidence($('a-confidence'), sf, [
      (input.t1 - input.tInf) < 1 && '峰採樣接近分布相',
      declareA.declaredAKI && 'AKI',
      declareA.declaredUnreliableDoseTiming && '給藥時間不可靠',
      declareA.declaredUnreliableSampleTiming && '採血時間不可靠',
      declareA.pregnant && '懷孕',
      declareA.cysticFibrosis && 'CF',
    ], '穩態雙點量測、取樣時相合理');

    // AKI 等聲明使外推維持劑量不可靠 → 對「達目標各間隔劑量表」加註（量測 AUC 仍有效，不隱藏表）
    const caveatEl = $('a-rec-caveat');
    if (!sf.allowDoseRecommendation) {
      caveatEl.hidden = false;
      caveatEl.textContent = '⚠️ 已聲明腎功能快速變化 / AKI：下表為線性外推的維持劑量，於腎功能不穩時不可靠，'
        + '須以重複濃度重新評估，勿直接延用。量測 AUC₂₄ 本身仍有效。';
    } else {
      caveatEl.hidden = true; caveatEl.textContent = '';
    }

    // 警示：safety 分布相訊息 + 既有域警示；AUC>600 改結構化處置、不出單行外推劑量
    const distMsgs = safetyWarnings(sf).filter((w) => w.level !== 'info' || true);
    let warnHtml = distMsgs;
    if (!aucHigh) {
      warnHtml = warnHtml.concat(r.warnings, [
        { level: 'info', msg: `目前方案每日 ${fmt(r.tddCurrent, 0)} mg → 達 AUC 500 需約 ${fmt(r.tddTarget, 0)} mg/day（比例線性外推）。` },
      ]);
    } else {
      warnHtml = warnHtml.concat(r.warnings);
    }
    renderWarnings($('a-warnings'), warnHtml);
    if (aucHigh) {
      $('a-warnings').insertAdjacentHTML('beforeend',
        managementCardHTML('AUC₂₄ > 600：先處置高暴露，勿逕依下表減量'));
    }

    // 計算式明細
    $('a-formula').innerHTML =
      `ke = ln(${input.c1}/${input.c2}) / (${input.t2}−${input.t1}) = ${fmt(r.ke, 4)} /h\n` +
      `真峰 Cmax(輸注末) = ${input.c1} × e^(ke×(${input.t1}−${input.tInf})) = ${fmt(r.cMaxTrue, 2)} mg/L\n` +
      `真谷 Cmin(間隔末) = ${input.c2} × e^(−ke×(${input.tau}−${input.t2})) = ${fmt(r.cMinTrue, 2)} mg/L\n` +
      `AUC_τ = 輸注梯形 (${fmt(r.aucInfusion, 1)}) + 消除對數梯形 (${fmt(r.aucElim, 1)}) = ${fmt(r.aucTau, 1)} mg·h/L\n` +
      `AUC₂₄ = AUC_τ × (24/${input.tau}) = ${fmt(r.auc24, 1)} mg·h/L\n` +
      `交叉驗證 TDD/CL = ${fmt(r.tddCurrent, 0)}/${fmt(r.cl, 2)} = ${fmt(r.auc24Check, 1)}（應相近）`;

    // 評估 Assessment（SOAP-A：臨床判讀）
    const statusTxt = st === 'ok' ? '達標' : st === 'low' ? '偏低（暴露不足）' : '偏高（AKI 風險）';
    const aA = [
      '【Vancomycin 評估 Assessment】（雙點反算，Sawchuk-Zaske）',
      `目前 ${input.dose} mg q${input.tau}h（${fmt(r.tddCurrent, 0)} mg/day）→ AUC₂₄ ${fmt(r.auc24, 0)}（AUC/MIC ${fmt(r.aucOverMic, 0)}，MIC ${mic}）→ ${statusTxt}`,
      `個體 PK：CL ${fmt(r.cl, 2)} L/h、t½ ${fmt(r.halfLife, 1)} h、Vd ${fmt(r.vd, 1)} L；預測峰/谷 ${fmt(r.cMaxTrue, 1)}/${fmt(r.cMinTrue, 1)} mg/L`,
      st === 'ok' ? '暴露達標，維持現方案，24–48h 後複驗。'
        : st === 'high' ? '暴露偏高（AUC>600），腎毒性風險上升，優先處置高暴露（方案見 Plan）。'
        : '暴露不足，需上調日劑量以達 AUC 500（方案見 Plan）。',
    ];
    if (mic >= VANCO.MIC_ALT_AGENT) aA.push(`MIC ≥ ${VANCO.MIC_ALT_AGENT}：傳統劑量難達標，考慮換藥。`);
    const aReasons = [
      declareA.declaredAKI && 'AKI', declareA.declaredUnreliableDoseTiming && '給藥時間不可靠',
      declareA.declaredUnreliableSampleTiming && '採血時間不可靠', declareA.pregnant && '懷孕',
      declareA.cysticFibrosis && 'CF', (input.t1 - input.tInf) < 1 && '峰採樣接近分布相',
    ].filter(Boolean);
    aA.push(`資料信心：${sf.confidence}（量測 AUC${aReasons.length ? '；' + aReasons.join('、') : '、取樣時相合理'}）`);
    if (!sf.allowDoseRecommendation) aA.push('腎功能不穩：外推維持劑量不可靠，須重複濃度重新評估。');
    $('a-assess').textContent = aA.join('\n');

    // 自訂試算：存個人化 PK + Plan 所需狀態，並以建議方案預填
    simCtx = {
      mode: 2, ke: r.ke, vd: r.vd, cl: r.cl, mic, tInf: r.tInf,
      dose: input.dose, tau: input.tau, tddCurrent: r.tddCurrent,
      auc24: r.auc24, aucOverMic: r.aucOverMic, st, statusTxt,
      tddTarget: r.tddTarget, intervalOptions: r.intervalOptions,
      akiExtrapUnreliable: !sf.allowDoseRecommendation,
    };
    planACustom = null;
    buildPlanA(); // 建立 Plan（無自訂時用外推方案）
    const recOpt = r.intervalOptions.find((o) => o.intervalH === input.tau) || r.intervalOptions[1];
    $('sim-dose').value = recOpt.doseMg;
    $('sim-tau').value = recOpt.intervalH;
    $('sim-out').innerHTML = '';

    show('a');
  });
  wireCopy('a-assess-copy', () => $('a-assess').textContent);
  wireCopy('a-copy', () => $('a-plan').textContent);

  // Mode 2 Plan（可複製）：僅行動，PK/濃度/峰谷判讀見 Assessment；含自訂選定方案
  let planACustom = null;
  function buildPlanA() {
    const s = simCtx; if (!s || s.mode !== 2) return;
    const pl = [
      '【Vancomycin 劑量調整 Plan】',
      `現行 ${s.dose} mg q${s.tau}h（${fmt(s.tddCurrent, 0)} mg/day）→ AUC24 ${fmt(s.auc24, 0)}（${s.statusTxt}）`,
    ];
    if (s.akiExtrapUnreliable) pl.push('⚠️ 已聲明 AKI：下列外推維持劑量不可靠，須以重複濃度重新評估，勿直接延用。');
    if (s.st === 'ok') {
      pl.push('建議：維持現方案，24–48h 後複驗。');
    } else if (s.st === 'high') {
      pl.push('⛔ AUC>600（腎毒性風險）→ 結構化處置，勿逕減量：');
      SAFETY.auc600Management().forEach((x) => pl.push(`  · ${x}`));
      pl.push('（下列外推劑量僅供處置後參考。）');
    } else {
      pl.push(`建議日劑量 ~${fmt(s.tddTarget, 0)} mg（達 AUC 500）：`);
    }
    if (s.st !== 'ok') {
      s.intervalOptions.forEach((o) => {
        const mark = o.intervalH === s.tau ? ' ★維持原間隔' : '';
        const flag = o.impractical ? '（單次過大）' : '';
        pl.push(`  · ${o.doseMg} mg q${o.intervalH}h${flag}｜峰/谷 ${fmt(o.projectedPeak, 1)}/${fmt(o.projectedTrough, 1)}、AUC24 ${fmt(o.projectedAuc24, 0)}${mark}`);
      });
    }
    if (planACustom) {
      const c = planACustom;
      pl.push(`★ 自訂選定：${c.dose} mg q${c.tau}h（${fmt(c.dailyMg, 0)} mg/day）→ 峰/谷 ${fmt(c.peak, 1)}/${fmt(c.trough, 1)}、AUC24 ${fmt(c.auc24, 0)}（${c.tag}）`);
    }
    pl.push('複驗：調整後 24–48h。Sawchuk-Zaske first-order；須專業覆核。');
    $('a-plan').textContent = pl.join('\n');
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
    const st = s.auc24 > VANCO.AUC_AKI_THRESHOLD ? 'high' : s.auc24 < VANCO.AUC_TARGET_MIN ? 'low' : 'ok';
    const tag = st === 'ok' ? '達標' : st === 'low' ? '偏低' : '偏高';
    $('sim-out').innerHTML =
      '<div class="sim-result">' +
      metric('預測峰值', fmt(s.peak, 1), 'mg/L') +
      metric('預測谷值', fmt(s.trough, 1), 'mg/L') +
      metric('AUC₂₄', fmt(s.auc24, 0), 'mg·h/L', true) +
      metric('AUC/MIC', fmt(s.aucOverMic, 0), '') +
      metric('日劑量', fmt(s.dailyMg, 0), 'mg') +
      '</div>' +
      `<span class="sim-badge sim-badge--${st}">AUC ${tag}（目標 400–600）</span>` +
      (s.impractical ? ' <span class="sim-badge sim-badge--high">⚠ 單次劑量過大</span>' : '');
    // 帶入 Plan：自訂選定方案
    planACustom = { dose, tau, dailyMg: s.dailyMg, peak: s.peak, trough: s.trough, auc24: s.auc24, tag };
    buildPlanA();
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

  function alertBayes(msg) {
    $('b-hero').innerHTML = ''; $('b-pk').innerHTML = ''; $('b-fit').innerHTML = '';
    $('b-rec').innerHTML = ''; $('b-formula').innerHTML = ''; $('b-confidence').innerHTML = '';
    renderWarnings($('b-warnings'), [{ level: 'error', msg }]);
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
      alertBayes(sf.messages.filter((m) => m.severity === 'block').map((m) => m.text).join('　'));
      return;
    }
    const canRecommend = sf.allowDoseRecommendation;

    // 資料信心 badge（tier 由 evaluateDataQuality/eligibility 合併，L2 shrinkage 背書）
    renderConfidence($('b-confidence'), sf, [
      levels.length === 1 && '單一濃度',
      !steadyState && '非穩態',
      dialysis && '血液透析',
      declare.declaredAKI && 'AKI',
      declare.declaredUnreliableDoseTiming && '給藥時間不可靠',
      declare.declaredUnreliableSampleTiming && '採血時間不可靠',
      declare.pregnant && '懷孕',
      declare.cysticFibrosis && 'CF',
    ], '穩態雙點，資訊量佳（L2 shrinkage ~0.21）');

    // Hero
    const auc = r.auc24Current;
    const st = auc > VANCO.AUC_AKI_THRESHOLD ? 'high' : auc < VANCO.AUC_TARGET_MIN ? 'low' : 'ok';
    const tag = st === 'ok' ? '達標' : st === 'low' ? '偏低' : '偏高';
    const aucLabel = steadyState
      ? 'AUC₂₄ (mg·h/L)　目標 400–600'
      : 'AUC₂₄ 穩態投影　非當日實際暴露';
    $('b-hero').className = `auc-hero auc-hero--${st}`;
    $('b-hero').innerHTML =
      `<div><div class="auc-hero__num">${fmt(auc, 0)}</div><div class="auc-hero__label">${aucLabel}</div></div>
       <div><div class="auc-hero__num">${fmt(auc / mic, 0)}</div><div class="auc-hero__label">AUC/MIC（MIC ${mic}）</div></div>
       <span class="auc-hero__tag">${tag}</span>`;

    // 個體 PK
    const shrink = (eta) => `${eta >= 0 ? '+' : ''}${(eta * 100).toFixed(0)}%`;
    $('b-pk').innerHTML =
      metric('Cockcroft-Gault CrCl', fmt(r.crcl, 0), 'mL/min') +
      metric('個體 CL', fmt(r.cl, 2), 'L/h', true) +
      metric('先驗 CL → 個體', `${fmt(r.prior.cl, 2)} → ${fmt(r.cl, 2)}`, `η ${shrink(r.eta.cl)}`) +
      metric('中央室 Vc', fmt(r.vc, 1), 'L') +
      metric('周邊室 Vp', fmt(r.vp, 1), 'L') +
      metric('穩態分布體積 Vss', fmt(r.vss, 1), 'L');

    // 擬合檢核
    const fitRows = r.predictedAtObs.map((p, i) => {
      const d = p.predicted - p.observed;
      return `<tr><td>第 ${i + 1} 點 (t=${fmt(levels[i].tRel, 1)}h)</td>
        <td>${fmt(p.observed, 1)}</td><td>${fmt(p.predicted, 1)}</td>
        <td style="color:${Math.abs(d) <= 3 ? 'var(--color-green)' : 'var(--color-amber)'}">${d >= 0 ? '+' : ''}${fmt(d, 1)}</td></tr>`;
    }).join('');
    $('b-fit').innerHTML =
      `<thead><tr><th>採血點</th><th>實測 (mg/L)</th><th>模型預測</th><th>差值</th></tr></thead><tbody>${fitRows}</tbody>`;

    // 建議劑量（同間隔達目標 AUC）
    const recTDD = r.recommendTDD(targetAuc);
    const recDose = PK.roundDose(recTDD * (tau / 24), 250);
    const recExp = BAYES.steadyStateExposure(recDose, tau, tInf, { cl: r.cl, vc: r.vc, vp: r.vp, q: r.q });
    $('b-rec-tau').textContent = tau;
    const impractical = recDose > VANCO.MAINT_PERDOSE_PRACTICAL_MAX;
    if (canRecommend) {
      $('b-rec').innerHTML =
        metric('建議劑量', `${recDose}${impractical ? '⚠' : ''} q${tau}h`, `＝${fmt(recDose * (24 / tau), 0)}/day`, true) +
        metric(`達目標 AUC ${targetAuc}`, fmt(recExp.auc24, 0), 'mg·h/L', true) +
        metric('穩態預測峰 / 谷', `${fmt(recExp.peak, 1)} / ${fmt(recExp.trough, 1)}`, 'mg/L');
    } else if (st === 'high') {
      $('b-rec').innerHTML = managementCardHTML('AUC₂₄ > 600：先處置高暴露，暫不輸出劑量建議');
    } else if (dialysis) {
      $('b-rec').innerHTML =
        `<div class="alert alert--warn" style="display:block"><b>⚠️ 血液透析：experimental / research-use</b><br>`
        + `Goti 僅以 CL×0.7、Vc×0.5 近似，未建模透析清除、intradialytic dosing 與 post-HD 回彈。`
        + `本模式僅供 AUC 估計參考，<b>不輸出具體劑量建議</b>，須臨床人員自行判斷。</div>`;
    } else {
      $('b-rec').innerHTML =
        `<div class="alert alert--warn" style="display:block">此案暫不輸出劑量建議（詳見下方警示）。</div>`;
    }

    // 警示：safety（eligibility / dataQuality / bayesFit / auc）+ 領域補充
    const w = safetyWarnings(sf);
    if (levels.some((l) => l.tRel < tInf)) w.push({ level: 'info', msg: '有採血點落在輸注期內（分布相）：二室 Bayesian 可處理，此為相對雙點法的優勢。' });
    if (mic >= VANCO.MIC_ALT_AGENT) w.push({ level: 'warn', msg: `MIC ≥ ${VANCO.MIC_ALT_AGENT} mg/L：傳統劑量難達 AUC/MIC ≥400，考慮換藥。` });
    w.push({ level: 'info', msg: '先驗模型：Goti 2018（住院成人）。重症病人先驗精度較低（Narayan 2021）；本估計須臨床覆核。' });
    renderWarnings($('b-warnings'), w);

    // 自訂試算：存 MAP 個體 PK + Plan 所需狀態
    // gateReasons：canRecommend=false 的成因，可同時成立且須全部揭露——
    // HD 病人 CL×0.7 常使 AUC 自然 >600，若只取最嚴重者，「Goti 未建模透析清除」
    // 會恰在最該出現時被 AUC>600 蓋掉。
    const gateReasons = canRecommend ? [] : [
      st === 'high' && 'auc600',
      dialysis && 'dialysis',
      declare.declaredAKI && 'aki',
    ].filter(Boolean);
    if (!canRecommend && !gateReasons.length) gateReasons.push('other');
    bSimCtx = {
      pk: { cl: r.cl, vc: r.vc, vp: r.vp, q: r.q },
      dose, tau, N, mic,
      auc, tag, st, steadyState, canRecommend, gateReasons,
      recDose, recExp,
    };
    planBCustom = null;
    buildPlanB();
    renderBSimCaveat();
    // 預填：可建議時帶入建議方案，否則沿用現行方案（讓使用者從現況起改）
    $('b-sim-dose').value = canRecommend ? recDose : dose;
    $('b-sim-tau').value = tau;
    $('b-sim-tinf').value = tInf;
    $('b-sim-out').innerHTML = '';

    // 評估 Assessment（SOAP-A：臨床判讀）
    const sex = sexMale ? '男' : '女';
    const lv = levels.map((l, i) => `C${i + 1} ${l.conc} mg/L @最近一劑後 ${l.tRel}h`).join('、');
    const clStatus = r.eta.cl > 0.05 ? '清除較族群先驗快' : r.eta.cl < -0.05 ? '清除較族群先驗慢' : '清除接近族群先驗';
    const bMaxResid = r.maxAbsResid;
    const bA = [
      '【Vancomycin 評估 Assessment】（Bayesian，Goti 2018 先驗）',
      `病人：${num('b-age')}歲 ${sex}，${num('b-tbw')}kg / ${num('b-height')}cm，SCr ${num('b-scr')}${dialysis ? '，血液透析' : ''}`,
      `目前 ${dose} mg q${tau}h（${fmt(dose * (24 / tau), 0)} mg/day，第 ${N} 劑）→ ${steadyState ? '' : '穩態投影 '}AUC₂₄ ${fmt(auc, 0)}（AUC/MIC ${fmt(auc / mic, 0)}，MIC ${mic}）→ ${tag}`,
      `濃度：${lv}`,
      `個體 CL ${fmt(r.cl, 2)} L/h（先驗 ${fmt(r.prior.cl, 2)}，η ${shrink(r.eta.cl)}）→ ${clStatus}；Vc ${fmt(r.vc, 1)}L、Vp ${fmt(r.vp, 1)}L、CrCl ${fmt(r.crcl, 0)} mL/min`,
      `資料信心：${sf.confidence}｜${levels.length === 1 ? '單一濃度（Vc/Vp 主要仰賴先驗）' : '雙點'}${steadyState ? '' : '、非穩態（穩態投影）'}；擬合最大殘差 ${fmt(bMaxResid, 1)} mg/L`,
    ];
    if (dialysis) bA.push('血液透析：Goti 二元共變數建模，透析後回彈須加強監測；不輸出具體劑量建議。');
    if (canRecommend) bA.push(st === 'ok' ? '暴露達標。' : `暴露${st === 'low' ? '不足，需上調' : '偏高，需下調'}劑量以達 AUC ${targetAuc}（方案見 Plan）。`);
    else if (st === 'high') bA.push('暴露偏高（>600）：優先處置高暴露，暫不輸出劑量建議（見 Plan）。');
    else bA.push('暫不輸出劑量建議（詳見警示）。');
    $('b-assess').textContent = bA.join('\n');

    // 模型細節
    $('b-formula').innerHTML =
      `先驗（Goti 2018，共變數代入）：\n` +
      `  TVCL = 4.5×(CrCl/120)^0.8×0.7^DIAL = ${fmt(r.prior.cl, 3)} L/h\n` +
      `  TVVc = 58.4×(WT/70)×0.5^DIAL = ${fmt(r.prior.vc, 2)} L；Vp ${fmt(r.prior.vp, 1)}；Q ${fmt(r.prior.q, 1)}\n` +
      `MAP 個體 η（P=TVP×e^η）：ηCL ${fmt(r.eta.cl, 3)}、ηVc ${fmt(r.eta.vc, 3)}、ηVp ${fmt(r.eta.vp, 3)}\n` +
      `目標函數 Obj = Σ(Cpred−Cobs)²/SD² + Σηₖ²/ωₖ² = ${fmt(r.objective, 3)}\n` +
      `AUC₂₄ = 每日總量 / 個體 CL = ${fmt(dose * (24 / tau), 0)} / ${fmt(r.cl, 2)} = ${fmt(auc, 1)} mg·h/L`;

    show('b');
  });
  wireCopy('b-assess-copy', () => $('b-assess').textContent);
  wireCopy('b-copy', () => $('b-plan').textContent);

  // Mode 3 Plan（可複製）：僅行動，病人/濃度/PK/判讀見 Assessment；含自訂選定方案
  let planBCustom = null;
  function buildPlanB() {
    const s = bSimCtx; if (!s) return;
    const pl = [
      '【Vancomycin Bayesian 劑量 Plan】',
      `現行 ${s.dose} mg q${s.tau}h（第 ${s.N} 劑）→ ${s.steadyState ? '' : '穩態投影 '}AUC24 ${fmt(s.auc, 0)}（${s.tag}）`,
    ];
    if (s.canRecommend) {
      pl.push(`建議：${s.recDose} mg q${s.tau}h（${fmt(s.recDose * (24 / s.tau), 0)} mg/day）→ 預測 AUC ${fmt(s.recExp.auc24, 0)}、穩態峰/谷 ${fmt(s.recExp.peak, 1)}/${fmt(s.recExp.trough, 1)}`);
    } else if (s.st === 'high') {
      pl.push('⛔ AUC>600：不逕給劑量建議，結構化處置：');
      SAFETY.auc600Management().forEach((x) => pl.push(`  · ${x}`));
    } else if (s.gateReasons.includes('dialysis')) {
      pl.push('血液透析：experimental，不輸出具體劑量建議（Goti 未建模透析清除）；劑量由臨床人員判斷。');
    } else {
      pl.push('暫不輸出劑量建議（詳見警示）。');
    }
    // AUC>600 已在上面走 auc600 分支；透析若同時成立，其警語不可被吞掉
    if (s.st === 'high' && s.gateReasons.includes('dialysis')) {
      pl.push('  ⚠️ 併血液透析：Goti 未建模透析清除／post-HD 回彈，上述 AUC 與下列投影本身即不可靠。');
    }
    if (planBCustom) {
      const c = planBCustom;
      pl.push(`★ 自訂選定：${c.dose} mg q${c.tau}h（輸注 ${c.tInf}h，${fmt(c.dailyMg, 0)} mg/day）→ 穩態峰/谷 ${fmt(c.peak, 1)}/${fmt(c.trough, 1)}、AUC24 ${fmt(c.auc24, 0)}（${c.tag}）`);
      if (!s.canRecommend) pl.push(`   （自訂試算為使用者指定方案之模型投影，非本工具建議；${gateNotes(s.gateReasons)}）`);
    }
    pl.push('監測：調整後 24–48h 複驗。須專業覆核。');
    $('b-plan').textContent = pl.join('\n');
  }

  // canRecommend=false 時，自訂試算仍照常投影（使用者主動指定的 what-if），但須標明其不可靠成因
  const GATE_NOTE = {
    auc600: 'AUC>600 須先處置高暴露，勿逕依試算減量',
    dialysis: 'Goti 未建模透析清除／post-HD 回彈，投影不可靠',
    aki: '腎功能不穩時 CL 非定值，穩態投影不可靠',
    other: '本案安全閘門已擋下劑量建議',
  };
  const gateNotes = (rs) => (rs || []).map((r) => GATE_NOTE[r] || GATE_NOTE.other).join('；');
  function renderBSimCaveat() {
    const el = $('b-sim-caveat'); const s = bSimCtx;
    if (!s || s.canRecommend) { el.hidden = true; el.textContent = ''; return; }
    el.hidden = false;
    el.textContent = `⚠️ ${gateNotes(s.gateReasons)}。下方試算為「你指定方案」的模型投影，`
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
    const st = e.auc24 > VANCO.AUC_AKI_THRESHOLD ? 'high' : e.auc24 < VANCO.AUC_TARGET_MIN ? 'low' : 'ok';
    const tag = st === 'ok' ? '達標' : st === 'low' ? '偏低' : '偏高';
    $('b-sim-out').innerHTML =
      '<div class="sim-result">' +
      metric('穩態峰值 (輸注末)', fmt(e.peak, 1), 'mg/L') +
      metric('穩態谷值 (間隔末)', fmt(e.trough, 1), 'mg/L') +
      metric('AUC₂₄', fmt(e.auc24, 0), 'mg·h/L', true) +
      metric('AUC/MIC', fmt(e.auc24 / bSimCtx.mic, 0), `MIC ${bSimCtx.mic}`) +
      metric('日劑量', fmt(dailyMg, 0), 'mg') +
      '</div>' +
      `<span class="sim-badge sim-badge--${st}">AUC ${tag}（目標 400–600）</span>` +
      (dose > VANCO.MAINT_PERDOSE_PRACTICAL_MAX ? ' <span class="sim-badge sim-badge--high">⚠ 單次劑量過大</span>' : '');
    planBCustom = { dose, tau, tInf, dailyMg, peak: e.peak, trough: e.trough, auc24: e.auc24, tag };
    buildPlanB();
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
  function alertResult(prefix, msg) {
    if (prefix === 'e') { $('e-output').innerHTML = ''; renderWarnings($('e-warnings'), [{ level: 'error', msg }]); }
    else { $('a-hero').innerHTML = ''; $('a-pk').innerHTML = ''; $('a-table').innerHTML = ''; $('a-formula').innerHTML = ''; renderWarnings($('a-warnings'), [{ level: 'error', msg }]); }
    show(prefix);
  }
})();
