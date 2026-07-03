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
    show('e');
  });
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

    // 自訂試算：存個人化 PK，並以建議方案預填
    simCtx = { ke: r.ke, vd: r.vd, cl: r.cl, mic, tInf: r.tInf };
    const recOpt = r.intervalOptions.find((o) => o.intervalH === input.tau) || r.intervalOptions[1];
    $('sim-dose').value = recOpt.doseMg;
    $('sim-tau').value = recOpt.intervalH;
    $('sim-out').innerHTML = '';

    show('a');
  });
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
