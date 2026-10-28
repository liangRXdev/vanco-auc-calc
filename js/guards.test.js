/* guards.test.js — 審查重現案例的端到端回歸（review 2026-10）
 * node js/guards.test.js
 *
 * 以 ui.js 相同的接線（PK → SAFETY → VIEWMODEL → SUMMARY）重跑審查時實測重現的輸入，
 * 斷言「BLOCK 或合理劑量」，且 BLOCK 時臨床摘要／臨床簡版不帶任何劑量。
 * 接線若與 ui.js 分歧，本檔即失去意義——改 ui.js 的 safety context 時請同步此處。
 */
const PK = require('./pk.js');
const S = require('./safety.js');
const VM = require('./viewmodel.js');
const SUM = require('./summary.js');

let pass = 0, fail = 0;
function c(id, cond, desc) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${desc}`);
  cond ? pass++ : fail++;
}
const has = (v, code) => v.messages.some((m) => m.code === code);
// 臨床簡版是否含任何「N mg」字樣（BLOCK 時不得出現劑量）
const hasDose = (t) => /\d+\s*mg(?!\/dL|·h)/.test(String(t).replace(/mg·h\/L|mg\/L/g, ''));

// ─────────── Mode 1（同 ui.js e-calc 接線）───────────
function runMode1(inp, opts) {
  const o = Object.assign({ icu: true, skipInputCheck: false }, opts || {});
  const r = PK.empiricDosing(inp);
  const sf = S.buildSafetyMessages({
    mode: 1,
    eligibility: { age: inp.age },
    dataQuality: { input: {}, mode: 1 },
    modelOutput: { model: r.clModel, cl: r.clPop, perDose: r.maintenanceDose, dailyMg: r.maintenanceDailyMg },
  });
  const view = VM.buildEmpiricViewModel({
    r, targetAuc: inp.targetAuc || 500, icu: o.icu, declared: {},
    demo: { age: inp.age, sexLabel: inp.sexMale ? '男' : '女', tbw: inp.tbw, heightCm: inp.heightCm, scr: inp.scr },
  });
  const sum = SUM.buildClinicalSummary(view, sf, 1);
  return { r, sf, view, sum, plan: SUM.buildClinicalPlan(sum) };
}

console.log('--- #1 Crass：90 歲女 155cm 100kg SCr 4 ---');
let m = runMode1({ age: 90, sexMale: false, heightCm: 155, tbw: 100, scr: 4, clModel: 'crass', criticallyIll: true });
c('G01', m.r.clPop < 0, '前置：Crass CLV 為負（重現 -4.14）');
c('G02', m.sf.status === 'BLOCK' && has(m.sf, 'E_MODEL_OUT_OF_RANGE') && has(m.sf, 'E_CRASS_CLV_LOW'),
  'safety BLOCK（CL ≤ 0 + Crass CLV < 0.5）');
c('G03', m.sum.blocked && m.sum.status.key !== 'ok' && m.sum.recommendation.regimen === null,
  '摘要不再顯示「達標／建議起始」');
c('G04', !hasDose(m.plan) && m.plan.indexOf('-2000') < 0, '臨床簡版不帶任何劑量');
c('G05', !isFinite(m.sum.current.auc24), 'BLOCK 時不顯示由負 CL 推得的 AUC');
c('G05b', m.sum.monitoring.some((x) => x.indexOf('Matzke') >= 0), '下一步明示改用 Matzke + 密集 TDM');

console.log('\n--- #1 Matzke：age 150（繞過輸入範圍，驗模型守衛本身）---');
m = runMode1({ age: 150, sexMale: true, heightCm: 180, tbw: 80, scr: 1, criticallyIll: true });
c('G06', m.sf.status === 'BLOCK' && has(m.sf, 'E_MODEL_OUT_OF_RANGE') && m.sum.blocked && !hasDose(m.plan),
  'age 150 → CrCl < 0 → 劑量 ≤ 0 → BLOCK，臨床簡版無劑量');

console.log('\n--- #2 Matzke：20 歲男 180cm 80kg ---');
m = runMode1({ age: 20, sexMale: true, heightCm: 180, tbw: 80, scr: 0.2, criticallyIll: true });
c('G07', !m.sum.blocked && m.sum.recommendation.regimen.dose === 1000 && m.sum.recommendation.regimen.tau === 8,
  'SCr 0.2 → SCr 以 0.7 代入、CrCl 封頂 150 → 1000 mg q8h（原 4750 mg q8h）');
c('G07b', m.sum.confidenceNote.indexOf('0.7') >= 0, '結果頁標示「SCr 已以 0.7 代入（機構政策）」');
c('G08', PK.validateEmpiricInput({ age: 20, heightCm: 180, tbw: 80, scr: 0.01 }).length > 0,
  'SCr 0.01 → 輸入範圍錯誤（原 92000 mg q8h）');
c('G09', PK.validateEmpiricInput({ age: 150, heightCm: 180, tbw: 80, scr: 1 }).length > 0,
  'age 150 → 輸入範圍錯誤（原 -250 mg）');

// ─────────── Mode 2（同 ui.js a-calc 接線）───────────
function runMode2(input, steadyStateConfirmed) {
  const r = PK.twoLevelAUC(input);
  const recOpt = PK.currentIntervalOption(r, input.tau);
  const sf = S.buildSafetyMessages({
    mode: 2,
    eligibility: {},
    dataQuality: { input: { steadyStateConfirmed: steadyStateConfirmed !== false }, mode: 2 },
    concentrations: {
      levels: { c1: input.c1, t1: input.t1, c2: input.c2, t2: input.t2 },
      dosing: { tau: input.tau, tInf: input.tInf },
      pk: { ke: r.ke, halfLife: r.halfLife, auc24: r.auc24 },
    },
    auc: r.auc24,
    modelOutput: { model: 'two-level', cl: r.cl, perDose: recOpt ? recOpt.doseMg : NaN, dailyMg: recOpt ? recOpt.dailyMg : NaN },
  });
  const view = VM.buildTwoLevelViewModel({ r, input, recOpt, declared: {}, steadyStateConfirmed: steadyStateConfirmed !== false });
  const sum = SUM.buildClinicalSummary(view, sf, 2);
  return { r, recOpt, sf, view, sum, plan: SUM.buildClinicalPlan(sum) };
}

console.log('\n--- #1 Mode 2：CL ≈ 0.22 L/h（2026-10 裁決：只擋劑量、保留量測 AUC）---');
m = runMode2({ dose: 50, tau: 12, tInf: 1, c1: 20, t1: 2, c2: 18.5, t2: 11.5, mic: 1 });
c('G10', m.r.cl < 0.25 && m.recOpt.doseMg === 0, '前置：現行 τ 12h、CL ≈ 0.22、主推薦圓整為 0 mg');
c('G11', m.sf.status !== 'BLOCK' && m.sf.allowCalculation && !m.sf.allowDoseRecommendation
  && has(m.sf, 'E_DOSE_TOO_LOW') && !has(m.sf, 'E_MODEL_OUT_OF_RANGE'),
  '建議劑量 0 → 只擋劑量建議（非 BLOCK）');
c('G12', m.sum.blocked && m.sum.recommendation.regimen === null && !hasDose(m.plan.split('建議：')[1]),
  '臨床摘要／簡版「建議」段不帶劑量（現行方案行除外）');
c('G12b', m.sum.canCalculate && isFinite(m.sum.current.auc24) && Math.abs(m.sum.current.auc24 - m.r.auc24) < 1e-9
  && m.sum.status.key === 'ok' && m.plan.indexOf(`${Math.round(m.r.auc24)} mg·h/L`) >= 0,
  '保留量測 AUC24 與判讀（摘要與臨床簡版）');
c('G12c', m.sum.blockedReasons.some((x) => x.indexOf('現行間隔下建議劑量過低而無法給出') >= 0
  && x.indexOf('延長間隔') >= 0 && x.indexOf('Mode 3') >= 0),
  '劑量區說明「現行間隔下建議劑量過低而無法給出；請依臨床判斷延長間隔或改用 Mode 3」');
c('G12d', m.sum.recommendation.kind === 'none' && m.sum.recommendation.regimen === null,
  '不自動改推薦其他間隔');
c('G13', m.view.alternatives.every((a) => a.dose > 0), '劑量為 0 的間隔列不列入替代方案');

console.log('\n--- Mode 2：現行 τ 48h、CL ≈ 0.22（主推薦不為 0）---');
m = runMode2({ dose: 250, tau: 48, tInf: 1, c1: 25, t1: 2, c2: 22, t2: 47, mic: 1 });
c('G14', m.recOpt.doseMg === 250 && !has(m.sf, 'E_DOSE_TOO_LOW') && !has(m.sf, 'E_MODEL_OUT_OF_RANGE')
  && !m.sum.blocked && m.sum.recommendation.regimen.tau === 48,
  'τ 48h 主推薦 250 mg q48h → 不觸發劑量守衛、正常給建議');
c('G15', isFinite(m.sum.current.auc24), '量測 AUC 照常顯示');

console.log('\n--- Mode 2：CL ≤ 0 合成案例仍 BLOCK ---');
const vNeg = S.buildSafetyMessages({ mode: 2, eligibility: {}, dataQuality: { input: { steadyStateConfirmed: true }, mode: 2 },
  auc: 400, modelOutput: { model: 'two-level', cl: -0.1, perDose: 0, dailyMg: 0 } });
c('G16', vNeg.status === 'BLOCK' && !vNeg.allowCalculation && has(vNeg, 'E_MODEL_OUT_OF_RANGE'), 'CL ≤ 0 → BLOCK');

console.log('\n--- #3 Mode 2 穩態前提 ---');
const STD = { dose: 1000, tau: 12, tInf: 1, c1: 20, t1: 3, c2: 7, t2: 11.5, mic: 1 };
m = runMode2(STD, true);
c('G20', !m.sum.blocked && m.sum.recommendation.regimen, '前置：已勾選穩態 → 正常給建議');
m = runMode2(STD, false);
c('G21', m.sum.blocked && m.sum.blockedReasons.some((x) => x.indexOf('穩態') >= 0)
  && m.sum.monitoring.some((x) => x.indexOf('Mode 3') >= 0) && !hasDose(m.plan.split('建議：')[1]),
  '未勾選穩態 → 封鎖劑量建議、下一步建議改用 Mode 3、臨床簡版無劑量');
c('G22', isFinite(m.sum.current.auc24), '未勾選穩態仍顯示量測 AUC（只擋劑量建議）');
c('G23', m.view.confidenceBaseNote.indexOf('穩態雙點量測') < 0 && m.view.confidenceFactors.indexOf('未確認穩態') >= 0,
  'confidenceBaseNote 不再無條件宣稱穩態');

console.log('\n--- #5 Mode 2：τ 36h ---');
m = runMode2({ dose: 1000, tau: 36, tInf: 1, c1: 30, t1: 3, c2: 10, t2: 35, mic: 1 }, true);
c('G30', m.recOpt.intervalH === 36 && (m.sum.blocked || m.sum.recommendation.regimen.tau === 36),
  '主推薦維持現行 q36h（原靜默換成 750 mg q12h）');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
