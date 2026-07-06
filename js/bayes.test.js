/* 簡易 sanity test：node js/bayes.test.js */
const BAYES = require('./bayes.js');
const { GOTI } = require('./constants.js');

let pass = 0, fail = 0;
function near(name, got, exp, tol = 0.05) {
  const ok = Math.abs(got - exp) <= Math.abs(exp) * tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(4)}, exp ~${exp}`);
  ok ? pass++ : fail++;
}
function ok(name, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  cond ? pass++ : fail++;
}

// ---------- 先驗：共變數 → 族群典型值 ----------
console.log('--- Goti 先驗共變數 ---');
const tvA = BAYES.priorTypicalValues({ crcl: 120, weightKg: 70, dialysis: false });
near('TVCL (CrCL120,非透析)', tvA.cl, 4.5);
near('TVVc (70kg,非透析)', tvA.vc, 58.4);
near('Vp 固定', tvA.vp, 38.4);
near('Q 固定', tvA.q, 6.5);

const tvB = BAYES.priorTypicalValues({ crcl: 60, weightKg: 70, dialysis: false });
near('TVCL (CrCL60) =4.5×0.5^0.8', tvB.cl, 4.5 * Math.pow(0.5, 0.8));

const tvD = BAYES.priorTypicalValues({ crcl: 120, weightKg: 70, dialysis: true });
near('透析 CL ×0.7', tvD.cl, 4.5 * 0.7);
near('透析 Vc ×0.5', tvD.vc, 58.4 * 0.5);

// ---------- CrCL 截斷規則 ----------
console.log('\n--- Goti CrCL 截斷 ---');
// 老年低 SCr：age70 scr0.6 → 視為 1.0
const crclElderly = BAYES.gotiCrCl(70, 70, 0.6, true);
near('老年 SCr<1→1', crclElderly, (140 - 70) * 70 / (72 * 1));
// 高 CrCL 截斷 150
const crclHigh = BAYES.gotiCrCl(30, 80, 0.5, true);
near('CrCL 上限截斷 150', crclHigh, 150, 0.0001);

// ---------- 二室模擬：穩態 AUC_tau ≈ dose/CL ----------
console.log('\n--- 二室 RK4 模擬穩態 AUC ---');
const pk = { cl: 4.5, vc: 58.4, vp: 38.4, q: 6.5 };
const doses = [];
for (let i = 0; i < 20; i++) doses.push({ time: i * 12, dose: 1000, tInf: 1 });
// 最後一個間隔 [228,240] 密集取樣，梯形積分
const ts = [];
for (let t = 228; t <= 240 + 1e-9; t += 0.25) ts.push(Math.round(t * 100) / 100);
const cs = BAYES.simulateConc(doses, ts, pk);
let aucTau = 0;
for (let i = 1; i < ts.length; i++) aucTau += (cs[i] + cs[i - 1]) / 2 * (ts[i] - ts[i - 1]);
near('穩態 AUC_tau ≈ dose/CL (1000/4.5)', aucTau, 1000 / 4.5, 0.02);

// ---------- MAP：無觀測 → 回到先驗（η≈0）----------
console.log('\n--- MAP 無觀測回到先驗 ---');
const noObs = BAYES.bayesianMAP({
  cov: { age: 60, weightKg: 70, scr: 1.0, sexMale: true, dialysis: false },
  tbw: 70, doses: [{ time: 0, dose: 1000, tInf: 1 }], obs: [],
});
ok('無觀測 η_CL≈0', Math.abs(noObs.eta.cl) < 1e-9);
near('無觀測 CL = 先驗 TVCL', noObs.cl, noObs.prior.cl, 1e-6);

// ---------- MAP 自洽回復：由已知個體參數產生濃度，MAP 應回復 CL ----------
console.log('\n--- MAP 自洽回復（無雜訊）---');
const cov = { age: 55, weightKg: 80, scr: 1.0, sexMale: true, dialysis: false };
const crclTrue = BAYES.gotiCrCl(cov.age, cov.weightKg, cov.scr, cov.sexMale);
const tvTrue = BAYES.priorTypicalValues({ crcl: crclTrue, weightKg: 80, dialysis: false });
// 設定「真值」個體：CL 較快、Vc 較小
const trueEta = [0.30, -0.20, 0.0];
const truePk = {
  cl: tvTrue.cl * Math.exp(trueEta[0]),
  vc: tvTrue.vc * Math.exp(trueEta[1]),
  vp: tvTrue.vp * Math.exp(trueEta[2]),
  q: tvTrue.q,
};
// 給藥史 10 劑 1250 mg q12h，於第 10 間隔取峰(110h)+谷(119.5h)
const dh = [];
for (let i = 0; i < 10; i++) dh.push({ time: i * 12, dose: 1250, tInf: 1 });
const obsTimes = [110, 119.5];
const obsConc = BAYES.simulateConc(dh, obsTimes, truePk);
const obs = obsTimes.map((t, i) => ({ time: t, conc: obsConc[i] }));

const map = BAYES.bayesianMAP({
  cov, tbw: 80, doses: dh, obs, currentDailyDose: 2500,
});
console.log(`  真值 CL=${truePk.cl.toFixed(3)}, MAP CL=${map.cl.toFixed(3)} (先驗 TVCL=${tvTrue.cl.toFixed(3)})`);
console.log(`  真值 Vc=${truePk.vc.toFixed(2)}, MAP Vc=${map.vc.toFixed(2)}`);
console.log(`  觀測峰=${obsConc[0].toFixed(2)}, 谷=${obsConc[1].toFixed(2)} mg/L`);
near('MAP 回復 CL ≈ 真值（先驗略收縮）', map.cl, truePk.cl, 0.08);
// 資訊案：MAP 解的目標函數應優於純先驗（η=0），代表資料改善了擬合
const objAt0 = BAYES.objective([0, 0, 0], tvTrue, dh, obs);
ok('MAP 目標函數 < 純先驗(η=0)', map.objective < objAt0);
// 殘差應在殘差誤差 SD 內（MAP 帶先驗懲罰，不追求零殘差）
const maxResid = Math.max(...map.predictedAtObs.map((p) => Math.abs(p.predicted - p.observed)));
ok(`擬合殘差 ${maxResid.toFixed(2)} < 殘差 SD(~數 mg/L)`, maxResid < 3);

// 往返一致：obs 由 η=0 先驗預測產生 → MAP 應回 η≈0、殘差趨零（隔離模擬器+optimizer 正確性）
console.log('\n--- 模擬器+optimizer 往返一致（η=0 資料）---');
const obs0conc = BAYES.simulateConc(dh, obsTimes, tvTrue);
const obs0 = obsTimes.map((t, i) => ({ time: t, conc: obs0conc[i] }));
const mapRT = BAYES.bayesianMAP({ cov, tbw: 80, doses: dh, obs: obs0 });
ok('往返 |η_CL|<0.02', Math.abs(mapRT.eta.cl) < 0.02);
const rtResid = Math.max(...mapRT.predictedAtObs.map((p) => Math.abs(p.predicted - p.observed)));
ok(`往返殘差 ${rtResid.toFixed(3)} < 0.05`, rtResid < 0.05);

// ---------- AUC24 恆等式與建議劑量 ----------
console.log('\n--- AUC24 = TDD/CL 與建議劑量 ---');
near('auc24Current = 2500/CL', map.auc24Current, 2500 / map.cl, 1e-6);
const tddFor500 = map.recommendTDD(500);
near('recommendTDD(500) 反算 AUC = 500', map.auc24(tddFor500), 500, 1e-6);
console.log(`  個體 CL=${map.cl.toFixed(2)} L/h → 現行 2500mg/day AUC24=${map.auc24Current.toFixed(0)}；達 AUC500 需 ${tddFor500.toFixed(0)} mg/day`);

// ---------- 先驗懲罰：單一 trough 時 CL 更新、Vc/Vp 應接近先驗 ----------
console.log('\n--- 單一 trough：CL 更新、Vc/Vp 貼近先驗 ---');
const singleObs = [{ time: 119.5, conc: obsConc[1] }];
const map1 = BAYES.bayesianMAP({ cov, tbw: 80, doses: dh, obs: singleObs });
console.log(`  單點 η: CL=${map1.eta.cl.toFixed(3)}, Vc=${map1.eta.vc.toFixed(3)}, Vp=${map1.eta.vp.toFixed(3)}`);
ok('單 trough：|η_Vp| 小於 |η_CL|（先驗主導體積）', Math.abs(map1.eta.vp) < Math.abs(map1.eta.cl) + 1e-9);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
