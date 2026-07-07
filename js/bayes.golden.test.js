/* bayes.golden.test.js — Golden-master 回歸基準
 * node js/bayes.golden.test.js
 *
 * L1（解析解 oracle）+ L2（模擬-估計）通過後，凍結代表案例的 bayesianMAP 輸出，
 * 防止未來改公式/常數靜默改變結果。輸入為**固定濃度**（非隨機生成），故輸出確定。
 * 若臨床上刻意更動模型 → 重新產生 golden 並於 log.md 記錄原因。
 */
const B = require('./bayes.js');

function mk(dose, tau, tInf, n) { const d = []; for (let i = 0; i < n; i++) d.push({ time: i * tau, dose, tInf }); return d; }

// 凍結基準（由 v0.3.1 引擎產生，2026-07-07；固定輸入濃度 → 確定輸出）
const GOLDEN = [
  {
    id: 'G1-single-trough',
    inp: { cov: { age: 60, weightKg: 70, scr: 1.0, sexMale: true, dialysis: false }, tbw: 70, doses: mk(1000, 12, 1, 8), obs: [{ time: 95.5, conc: 16 }], currentDailyDose: 2000 },
    exp: { cl: 3.569608, vc: 55.321814, vp: 38.805599, etaCL: 0.115287, etaVc: -0.054149, etaVp: 0.010507, auc24Current: 560.285685 },
  },
  {
    id: 'G2-peak-trough',
    inp: { cov: { age: 55, weightKg: 80, scr: 1.0, sexMale: true, dialysis: false }, tbw: 80, doses: mk(1250, 12, 1, 10), obs: [{ time: 110, conc: 30 }, { time: 119.5, conc: 9 }], currentDailyDose: 2500 },
    exp: { cl: 5.328701, vc: 46.831988, vp: 38.051942, etaCL: 0.360614, etaVc: -0.354281, etaVp: -0.009105, auc24Current: 469.157489 },
  },
  {
    id: 'G3-HD-single',
    inp: { cov: { age: 70, weightKg: 65, scr: 3.0, sexMale: true, dialysis: true }, tbw: 65, doses: mk(1000, 24, 1, 6), obs: [{ time: 143, conc: 15 }], currentDailyDose: 1000 },
    exp: { cl: 1.335693, vc: 24.114653, vp: 39.53263, etaCL: 0.533958, etaVc: -0.117241, etaVp: 0.029069, auc24Current: 748.675049 },
  },
];

let pass = 0, fail = 0;
const TOL = 1e-4; // 相對容差（optimizer 有極小非決定性餘裕）
for (const g of GOLDEN) {
  const r = B.bayesianMAP(g.inp);
  const got = { cl: r.cl, vc: r.vc, vp: r.vp, etaCL: r.eta.cl, etaVc: r.eta.vc, etaVp: r.eta.vp, auc24Current: r.auc24Current };
  for (const k of Object.keys(g.exp)) {
    const ok = Math.abs(got[k] - g.exp[k]) <= Math.max(Math.abs(g.exp[k]) * TOL, 1e-6);
    console.log(`${ok ? 'PASS' : 'FAIL'}  [${g.id}] ${k}: got ${got[k].toFixed(6)}, golden ${g.exp[k]}`);
    ok ? pass++ : fail++;
  }
}
console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
