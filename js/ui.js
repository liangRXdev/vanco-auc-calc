/* ui.js — DOM 綁定：讀輸入 → 呼叫 PK → 渲染結果 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const num = (id) => parseFloat($(id).value);
  const fmt = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '—');
  let simCtx = null; // 存最近一次反算的個人化 PK，供自訂試算沿用

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
    const r = PK.empiricDosing({
      age: num('e-age'),
      heightCm: num('e-height'),
      tbw: num('e-tbw'),
      scr: num('e-scr'),
      sexMale: document.querySelector('input[name="e-sex"]:checked').value === 'M',
      criticallyIll: $('e-icu').checked,
      targetAuc,
    });

    const icu = $('e-icu').checked;
    $('e-output').innerHTML =
      metric('Cockcroft-Gault CrCl', fmt(r.crcl, 0), 'mL/min', true) +
      metric('族群 CLvanco (Matzke)', fmt(r.clPop, 2), 'L/h') +
      metric('IBW / CrCl 用體重', `${fmt(r.ibw, 1)} / ${fmt(r.crclWeight.weight, 1)}`, 'kg') +
      (icu ? metric('負荷劑量 (TBW)', r.loadingDose + (r.loadingCapped ? '✱' : ''), 'mg', true) : '') +
      metric('理想日劑量 (目標)', fmt(r.tddTarget, 0), 'mg/day') +
      metric('建議維持 (圓整)', `${r.maintenanceDose} q${r.maintenanceInterval}h`, `＝${fmt(r.maintenanceDailyMg, 0)}/day`, true) +
      metric(`預測 AUC₂₄（目標 ${targetAuc}）`, fmt(r.predictedAuc24, 0), 'mg·h/L', true) +
      metric('預測峰 / 谷', `${fmt(r.predictedPeak, 1)} / ${fmt(r.predictedTrough, 1)}`, 'mg/L');
    const extra = [];
    extra.push({ level: 'info', msg: `CrCl 體重採「${r.crclWeight.label}」；負荷 mg/kg 用 TBW，維持以族群 CL 反推目標 AUC。` });
    if (r.loadingCapped) extra.push({ level: 'info', msg: '✱ 負荷已封頂於 3000 mg。' });
    renderWarnings($('e-warnings'), extra.concat(r.warnings));

    // Plan（可複製）
    const sex = document.querySelector('input[name="e-sex"]:checked').value === 'M' ? '男' : '女';
    const lines = [
      '【Vancomycin 起始劑量建議】',
      `病人：${num('e-age')}歲 ${sex}，${num('e-tbw')}kg / ${num('e-height')}cm，SCr ${num('e-scr')} mg/dL`,
      `CrCl (Cockcroft-Gault，${r.crclWeight.label} ${fmt(r.crclWeight.weight, 1)}kg) = ${fmt(r.crcl, 0)} mL/min｜族群 CL ${fmt(r.clPop, 2)} L/h`,
    ];
    if (icu) lines.push(`負荷劑量：${r.loadingDose} mg IV（actual body weight）${r.loadingCapped ? '（已封頂 3000mg）' : ''}`);
    lines.push(
      `維持劑量：${r.maintenanceDose} mg IV q${r.maintenanceInterval}h（日劑量 ${fmt(r.maintenanceDailyMg, 0)} mg）`,
      `目標 AUC24 ${targetAuc}（400–600, assume MIC 1）→ 預測 AUC24 ≈ ${fmt(r.predictedAuc24, 0)}、峰/谷 ${fmt(r.predictedPeak, 1)}/${fmt(r.predictedTrough, 1)}`,
      `監測：24–48h 內採雙點濃度驗證 AUC 後調整`,
      `—— 維持以族群 CL（Matzke）反推 AUC；負荷 mg/kg TBW。本工具僅供輔助，須專業覆核。`
    );
    $('e-plan').textContent = lines.join('\n');

    // 評估 Assessment（SOAP-A：臨床判讀）
    const eObese = num('e-tbw') > CG.OBESE_TBW_OVER_IBW * r.ibw;
    const eAucOk = r.predictedAuc24 >= VANCO.AUC_TARGET_MIN && r.predictedAuc24 <= VANCO.AUC_TARGET_MAX;
    const eA = [
      '【Vancomycin 評估 Assessment】（經驗起始，尚無血中濃度）',
      `病人：${num('e-age')}歲 ${sex}，${num('e-tbw')}kg / ${num('e-height')}cm，SCr ${num('e-scr')} mg/dL`,
      `腎功能：CrCl (Cockcroft-Gault，${r.crclWeight.label} ${fmt(r.crclWeight.weight, 1)}kg) = ${fmt(r.crcl, 0)} mL/min；族群 CL (Matzke) ${fmt(r.clPop, 2)} L/h`,
      `建議方案（${r.maintenanceDose} q${r.maintenanceInterval}h）預測 AUC₂₄ ≈ ${fmt(r.predictedAuc24, 0)}（目標 ${targetAuc}）→ ${eAucOk ? '達標' : '偏離，需檢視'}`,
    ];
    if (icu) eA.push(`重症/嚴重 MRSA：已納入負荷 ${r.loadingDose} mg（TBW）。`);
    if (eObese) eA.push('肥胖：族群 CL 為粗估，建議儘早雙點/Bayesian 驗證。');
    if (r.crcl < 30) eA.push('腎功能不全：間隔已延長，須密切監測。');
    eA.push('屬經驗估計，須 24–48h 內採濃度驗證。');
    $('e-assess').textContent = eA.join('\n');

    show('e');
  });
  wireCopy('e-assess-copy', () => $('e-assess').textContent);
  wireCopy('e-copy', () => $('e-plan').textContent);
  // 滑桿即時顯示目標 AUC 值
  $('e-target').addEventListener('input', () => { $('e-target-val').textContent = $('e-target').value; });

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

    // 警示
    renderWarnings($('a-warnings'), r.warnings.concat([
      { level: 'info', msg: `目前方案每日 ${fmt(r.tddCurrent, 0)} mg → 達 AUC 500 需約 ${fmt(r.tddTarget, 0)} mg/day（比例線性外推）。` },
    ]));

    // 計算式明細
    $('a-formula').innerHTML =
      `ke = ln(${input.c1}/${input.c2}) / (${input.t2}−${input.t1}) = ${fmt(r.ke, 4)} /h\n` +
      `真峰 Cmax(輸注末) = ${input.c1} × e^(ke×(${input.t1}−${input.tInf})) = ${fmt(r.cMaxTrue, 2)} mg/L\n` +
      `真谷 Cmin(間隔末) = ${input.c2} × e^(−ke×(${input.tau}−${input.t2})) = ${fmt(r.cMinTrue, 2)} mg/L\n` +
      `AUC_τ = 輸注梯形 (${fmt(r.aucInfusion, 1)}) + 消除對數梯形 (${fmt(r.aucElim, 1)}) = ${fmt(r.aucTau, 1)} mg·h/L\n` +
      `AUC₂₄ = AUC_τ × (24/${input.tau}) = ${fmt(r.auc24, 1)} mg·h/L\n` +
      `交叉驗證 TDD/CL = ${fmt(r.tddCurrent, 0)}/${fmt(r.cl, 2)} = ${fmt(r.auc24Check, 1)}（應相近）`;

    // Plan（可複製）
    const statusTxt = st === 'ok' ? '達標' : st === 'low' ? '偏低（暴露不足）' : '偏高（AKI 風險）';
    const pl = [
      '【Vancomycin AUC 評估與調整】',
      `目前方案：${input.dose} mg q${input.tau}h（日劑量 ${fmt(r.tddCurrent, 0)} mg），輸注 ${input.tInf}h`,
      `血中濃度：C1 ${input.c1} @${input.t1}h、C2 ${input.c2} @${input.t2}h（MIC ${mic}）`,
      `PK：ke ${fmt(r.ke, 4)}/h、t½ ${fmt(r.halfLife, 1)}h、Vd ${fmt(r.vd, 1)}L、CL ${fmt(r.cl, 2)} L/h`,
      `預測峰/谷：${fmt(r.cMaxTrue, 1)} / ${fmt(r.cMinTrue, 1)} mg/L`,
      `AUC24 = ${fmt(r.auc24, 0)} mg·h/L（AUC/MIC ${fmt(r.aucOverMic, 0)}）→ ${statusTxt}`,
    ];
    if (st === 'ok') {
      pl.push('建議：AUC 已達標，維持現方案；24–48h 後複驗。');
    } else {
      pl.push(`建議：調整日劑量至 ~${fmt(r.tddTarget, 0)} mg（比例線性外推至 AUC 500）`);
      r.intervalOptions.forEach((o) => {
        const mark = o.intervalH === input.tau ? '  ★[建議：維持原間隔]' : '';
        const flag = o.impractical ? '（單次過大）' : '';
        pl.push(`  · ${o.doseMg} mg q${o.intervalH}h${flag}｜峰/谷 ${fmt(o.projectedPeak, 1)}/${fmt(o.projectedTrough, 1)}、AUC24 ${fmt(o.projectedAuc24, 0)}${mark}`);
      });
      pl.push('複測：調整後 24–48h 複驗 AUC。');
    }
    pl.push('—— Sawchuk-Zaske first-order；本工具僅供輔助，須專業覆核。');
    $('a-plan').textContent = pl.join('\n');

    // 評估 Assessment（SOAP-A：臨床判讀）
    const aA = [
      '【Vancomycin 評估 Assessment】（雙點反算，Sawchuk-Zaske）',
      `目前 ${input.dose} mg q${input.tau}h（${fmt(r.tddCurrent, 0)} mg/day）→ AUC₂₄ ${fmt(r.auc24, 0)}（AUC/MIC ${fmt(r.aucOverMic, 0)}，MIC ${mic}）→ ${statusTxt}`,
      `個體 PK：CL ${fmt(r.cl, 2)} L/h、t½ ${fmt(r.halfLife, 1)} h、Vd ${fmt(r.vd, 1)} L；預測峰/谷 ${fmt(r.cMaxTrue, 1)}/${fmt(r.cMinTrue, 1)} mg/L`,
      st === 'ok' ? '暴露達標，維持現方案，24–48h 後複驗。' : `暴露${st === 'low' ? '不足' : '偏高'}，需調整日劑量至 ~${fmt(r.tddTarget, 0)} mg（達 AUC 500）。`,
    ];
    if (mic >= VANCO.MIC_ALT_AGENT) aA.push(`MIC ≥ ${VANCO.MIC_ALT_AGENT}：傳統劑量難達標，考慮換藥。`);
    $('a-assess').textContent = aA.join('\n');

    // 自訂試算：存個人化 PK，並以建議方案預填
    simCtx = { ke: r.ke, vd: r.vd, cl: r.cl, mic, tInf: r.tInf };
    const recOpt = r.intervalOptions.find((o) => o.intervalH === input.tau) || r.intervalOptions[1];
    $('sim-dose').value = recOpt.doseMg;
    $('sim-tau').value = recOpt.intervalH;
    $('sim-out').innerHTML = '';

    show('a');
  });
  wireCopy('a-assess-copy', () => $('a-assess').textContent);
  wireCopy('a-copy', () => $('a-plan').textContent);

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
    $('b-rec').innerHTML = ''; $('b-formula').innerHTML = '';
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

    // Hero
    const auc = r.auc24Current;
    const st = auc > VANCO.AUC_AKI_THRESHOLD ? 'high' : auc < VANCO.AUC_TARGET_MIN ? 'low' : 'ok';
    const tag = st === 'ok' ? '達標' : st === 'low' ? '偏低' : '偏高';
    $('b-hero').className = `auc-hero auc-hero--${st}`;
    $('b-hero').innerHTML =
      `<div><div class="auc-hero__num">${fmt(auc, 0)}</div><div class="auc-hero__label">AUC₂₄ (mg·h/L)　目標 400–600</div></div>
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
    $('b-rec').innerHTML =
      metric('建議劑量', `${recDose}${impractical ? '⚠' : ''} q${tau}h`, `＝${fmt(recDose * (24 / tau), 0)}/day`, true) +
      metric(`達目標 AUC ${targetAuc}`, fmt(recExp.auc24, 0), 'mg·h/L', true) +
      metric('穩態預測峰 / 谷', `${fmt(recExp.peak, 1)} / ${fmt(recExp.trough, 1)}`, 'mg/L');

    // 警示
    const w = [];
    if (st === 'high') w.push({ level: 'warn', msg: `AUC₂₄ ${fmt(auc, 0)} > ${VANCO.AUC_AKI_THRESHOLD}：AKI 風險上升，建議依上表減量。` });
    if (st === 'low') w.push({ level: 'warn', msg: `AUC₂₄ ${fmt(auc, 0)} < ${VANCO.AUC_TARGET_MIN}：暴露不足，建議依上表加量。` });
    if (levels.length === 1) w.push({ level: 'info', msg: '單一濃度：CL 已依實測更新，但 Vc/Vp 主要來自族群先驗；若需更可靠峰值估計，建議補第 2 點（峰）。' });
    if (levels.some((l) => l.tRel < tInf)) w.push({ level: 'info', msg: '有採血點落在輸注期內（分布相）：二室 Bayesian 可處理，此為相對雙點法的優勢。' });
    if (dialysis) w.push({ level: 'info', msg: '血液透析：Goti 以間歇性高通量 HD 二元共變數建模，無法反映實際透析時段/CRRT；透析後回彈請加強監測。' });
    if (mic >= VANCO.MIC_ALT_AGENT) w.push({ level: 'warn', msg: `MIC ≥ ${VANCO.MIC_ALT_AGENT} mg/L：傳統劑量難達 AUC/MIC ≥400，考慮換藥。` });
    w.push({ level: 'info', msg: '先驗模型：Goti 2018（住院成人）。重症病人先驗精度較低（Narayan 2021）；本估計須臨床覆核。' });
    renderWarnings($('b-warnings'), w);

    // Plan
    const sex = sexMale ? '男' : '女';
    const lv = levels.map((l, i) => `C${i + 1} ${l.conc} mg/L @最近一劑後 ${l.tRel}h`).join('、');
    const pl = [
      '【Vancomycin Bayesian AUC 評估（Goti 2018 先驗）】',
      `病人：${num('b-age')}歲 ${sex}，${num('b-tbw')}kg / ${num('b-height')}cm，SCr ${num('b-scr')}${dialysis ? '，血液透析' : ''}`,
      `現行：${dose} mg q${tau}h（第 ${N} 劑，日劑量 ${fmt(dose * (24 / tau), 0)} mg）`,
      `濃度：${lv}（MIC ${mic}）`,
      `個體 PK：CL ${fmt(r.cl, 2)} L/h（先驗 ${fmt(r.prior.cl, 2)}）、Vc ${fmt(r.vc, 1)}L、Vp ${fmt(r.vp, 1)}L、CrCl ${fmt(r.crcl, 0)}`,
      `目前 AUC₂₄ = ${fmt(auc, 0)} mg·h/L（AUC/MIC ${fmt(auc / mic, 0)}）→ ${tag}`,
      `建議：${recDose} mg q${tau}h（${fmt(recDose * (24 / tau), 0)} mg/day）→ 預測 AUC ${fmt(recExp.auc24, 0)}、穩態峰/谷 ${fmt(recExp.peak, 1)}/${fmt(recExp.trough, 1)}`,
      '監測：調整後 24–48h 複驗；Goti 先驗（住院成人），須專業覆核。',
    ];
    $('b-plan').textContent = pl.join('\n');

    // 評估 Assessment（SOAP-A：臨床判讀）
    const clStatus = r.eta.cl > 0.05 ? '清除較族群先驗快' : r.eta.cl < -0.05 ? '清除較族群先驗慢' : '清除接近族群先驗';
    const bMaxResid = Math.max(...r.predictedAtObs.map((p) => Math.abs(p.predicted - p.observed)));
    const bA = [
      '【Vancomycin 評估 Assessment】（Bayesian，Goti 2018 先驗）',
      `目前 ${dose} mg q${tau}h（${fmt(dose * (24 / tau), 0)} mg/day，第 ${N} 劑）→ AUC₂₄ ${fmt(auc, 0)}（AUC/MIC ${fmt(auc / mic, 0)}，MIC ${mic}）→ ${tag}`,
      `個體 CL ${fmt(r.cl, 2)} L/h（先驗 ${fmt(r.prior.cl, 2)}，η ${shrink(r.eta.cl)}）→ ${clStatus}；CrCl ${fmt(r.crcl, 0)} mL/min`,
      `資料信心：${levels.length === 1 ? '單一濃度（Vc/Vp 主要仰賴先驗）' : '雙點'}；擬合最大殘差 ${fmt(bMaxResid, 1)} mg/L`,
    ];
    if (dialysis) bA.push('血液透析：Goti 二元共變數建模，透析後回彈須加強監測。');
    bA.push(st === 'ok' ? '暴露達標。' : `暴露${st === 'low' ? '不足' : '偏高'}，建議調整為 ${recDose} mg q${tau}h（達 AUC ${targetAuc}）。`);
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
