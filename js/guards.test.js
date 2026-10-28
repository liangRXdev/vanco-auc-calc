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

console.log('\n--- #1 Matzke：age 150（繞過輸入範圍，驗模型守衛本身）---');
m = runMode1({ age: 150, sexMale: true, heightCm: 180, tbw: 80, scr: 1, criticallyIll: true });
c('G06', m.sf.status === 'BLOCK' && has(m.sf, 'E_MODEL_OUT_OF_RANGE') && m.sum.blocked && !hasDose(m.plan),
  'age 150 → CrCl < 0 → 劑量 ≤ 0 → BLOCK，臨床簡版無劑量');

// ─────────── Mode 2（同 ui.js a-calc 接線）───────────
function runMode2(input) {
  const r = PK.twoLevelAUC(input);
  const recOpt = r.intervalOptions.find((x) => x.intervalH === input.tau) || null;
  const sf = S.buildSafetyMessages({
    mode: 2,
    eligibility: {},
    concentrations: {
      levels: { c1: input.c1, t1: input.t1, c2: input.c2, t2: input.t2 },
      dosing: { tau: input.tau, tInf: input.tInf },
      pk: { ke: r.ke, halfLife: r.halfLife, auc24: r.auc24 },
    },
    auc: r.auc24,
    modelOutput: { model: 'two-level', cl: r.cl, perDose: recOpt ? recOpt.doseMg : NaN, dailyMg: recOpt ? recOpt.dailyMg : NaN },
  });
  const view = VM.buildTwoLevelViewModel({ r, input, recOpt, declared: {} });
  const sum = SUM.buildClinicalSummary(view, sf, 2);
  return { r, recOpt, sf, view, sum, plan: SUM.buildClinicalPlan(sum) };
}

console.log('\n--- #1 Mode 2：CL ≈ 0.22 L/h ---');
m = runMode2({ dose: 100, tau: 24, tInf: 1, c1: 20, t1: 3, c2: 18, t2: 23, mic: 1 });
c('G10', m.r.cl < 0.25 && m.recOpt.doseMg === 0, '前置：CL ≈ 0.22、同間隔建議劑量圓整為 0 mg');
c('G11', m.sf.status === 'BLOCK' && has(m.sf, 'E_MODEL_OUT_OF_RANGE'), '建議劑量 0 → safety BLOCK');
c('G12', m.sum.blocked && !hasDose(m.plan.split('建議：')[1]),
  '臨床簡版「建議」段不帶劑量（現行方案行除外）');
c('G13', m.view.alternatives.every((a) => a.dose > 0), '劑量為 0 的間隔列不列入替代方案');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
