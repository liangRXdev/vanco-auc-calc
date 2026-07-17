/* safety.test.js — 確定性安全層行為驗證（C-cases）
 * node js/safety.test.js
 * 驗的是 safety 層「行為」（該 BLOCK/WARNING 有無正確觸發），非估計器數值準確性（準確性走 pk/bayes test 與 L2）。
 */
const S = require('./safety.js');

let pass = 0, fail = 0;
function c(id, cond, desc) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${desc}`);
  cond ? pass++ : fail++;
}
const has = (v, code) => v.messages.some((m) => m.code === code);

// ─────────── Eligibility（A1/A2）───────────
console.log('--- Eligibility ---');
let v;
v = S.evaluateEligibility({ age: 10 });
c('C01', v.status === 'BLOCK' && !v.allowCalculation && has(v, 'E_PEDIATRIC'), '小兒 <18 → BLOCK、禁算');

v = S.evaluateEligibility({ age: 60, crrt: true });
c('C02', v.status === 'BLOCK' && has(v, 'E_CRRT'), 'CRRT → BLOCK');

v = S.evaluateEligibility({ age: 60, dialysis: true });
c('C03', v.status === 'WARNING' && v.allowCalculation && !v.allowDoseRecommendation && has(v, 'E_HD'),
  'HD 被選 → WARNING、可算但不給劑量建議');

v = S.evaluateEligibility({ age: 60, declaredAKI: true });
c('C04', v.status === 'WARNING' && !v.allowDoseRecommendation && has(v, 'E_AKI'),
  '聲明 AKI（預設/Mode 2/3）→ WARNING、不給劑量建議');

v = S.evaluateEligibility({ age: 60, declaredAKI: true }, 1);
c('C04b', v.status === 'WARNING' && v.allowDoseRecommendation && v.confidence === 'Low' && has(v, 'E_AKI'),
  '聲明 AKI（Mode 1 經驗）→ WARNING、仍給起始劑量但信心降 Low');

v = S.evaluateEligibility({ age: 30, pregnant: true });
c('C05', v.status === 'WARNING' && v.allowCalculation && v.allowDoseRecommendation && has(v, 'E_PREGNANT'),
  '懷孕 → WARNING（非 BLOCK）、仍可算且可建議');

v = S.evaluateEligibility({ age: 25, cysticFibrosis: true });
c('C06', v.status === 'WARNING' && v.allowCalculation && has(v, 'E_CF'), 'CF → WARNING（非 BLOCK）');

v = S.evaluateEligibility({ age: 45, ecmo: true });
c('C07', v.status === 'WARNING' && v.allowCalculation && has(v, 'E_ECMO'), 'ECMO → 強 WARNING、仍可算');

v = S.evaluateEligibility({ age: 65 });
c('C08', v.status === 'OK' && v.confidence === 'High' && v.allowDoseRecommendation, '正常成人無旗標 → OK/High');

// ─────────── validateConcentrations（B1）───────────
console.log('\n--- Mode 2 濃度守衛 ---');
const dosing = { tau: 12, tInf: 1 };
v = S.validateConcentrations({ c1: 20, t1: 3, c2: 7, t2: 11.5 }, dosing, { ke: 0.12, halfLife: 5.6, auc24: 340 });
c('C09', v.status === 'OK' && v.allowCalculation, '合理雙點（gap 2h）→ OK');

v = S.validateConcentrations({ c1: 20, t1: 0.5, c2: 7, t2: 11.5 }, dosing);
c('C10', v.status === 'BLOCK' && has(v, 'C_IN_INFUSION'), '第一點落在輸注期內 → BLOCK');

v = S.validateConcentrations({ c1: 7, t1: 3, c2: 20, t2: 11.5 }, dosing);
c('C11', v.status === 'BLOCK' && has(v, 'C_NOT_DECAYING'), '峰≤谷（未遞減）→ BLOCK');

v = S.validateConcentrations({ c1: 20, t1: 1.3, c2: 7, t2: 11.5 }, dosing);
c('C12', v.status === 'WARNING' && v.confidence === 'Low' && has(v, 'C_DIST_PHASE'), '距輸注末 0.3h（分布相）→ 強 WARNING/Low');

v = S.validateConcentrations({ c1: 20, t1: 1.7, c2: 7, t2: 11.5 }, dosing);
c('C13', v.status === 'WARNING' && v.confidence === 'Moderate', '距輸注末 0.7h → WARNING/Moderate');

v = S.validateConcentrations({ c1: 20, t1: 3, c2: 7, t2: 11.5 }, dosing, { ke: -0.1, halfLife: NaN, auc24: NaN });
c('C14', v.status === 'BLOCK' && has(v, 'C_KE_NONPOS') && has(v, 'C_AUC_NONFINITE'), 'ke≤0 且 AUC NaN → BLOCK');

// ─────────── validateBayesianFit（B2）───────────
console.log('\n--- Mode 3 Bayesian 擬合守衛 ---');
const goodFit = {
  converged: true, fitReliable: true, nonFinite: false,
  eta: { cl: 0.15, vc: -0.1, vp: 0.0 },
  predictedAtObs: [{ observed: 25, predicted: 25.3 }, { observed: 7, predicted: 6.8 }],
};
v = S.validateBayesianFit(goodFit);
c('C15', v.status === 'OK' && v.allowCalculation, '良好擬合 → OK');

v = S.validateBayesianFit(Object.assign({}, goodFit, { nonFinite: true }));
c('C16', v.status === 'BLOCK' && has(v, 'B_NONFINITE'), 'nonFinite → BLOCK');

v = S.validateBayesianFit(Object.assign({}, goodFit, { converged: false }));
c('C17', v.status === 'BLOCK' && has(v, 'B_NO_CONVERGE'), '未收斂 → BLOCK');

v = S.validateBayesianFit(Object.assign({}, goodFit, { fitReliable: false }));
c('C18', v.status === 'BLOCK' && has(v, 'B_UNSTABLE'), '多起點不一致 → BLOCK');

v = S.validateBayesianFit(Object.assign({}, goodFit, { eta: { cl: 1.2, vc: -0.1, vp: 0 } }));
c('C19', v.status === 'WARNING' && has(v, 'B_ETA_CL'), '|ηCL| 過大 → WARNING');

// ηVc/ηVp 大但 ηCL 小 → 不得觸發 WARNING（Vc/Vp 先驗主導屬正常）
v = S.validateBayesianFit(Object.assign({}, goodFit, { eta: { cl: 0.1, vc: 1.5, vp: 1.2 } }));
c('C19b', v.status === 'OK', 'ηVc/ηVp 大但 ηCL 小 → 仍 OK（不對體積觸發）');

// 低預測 vs 高實測＝典型 poor fit（SD 以預測濃度計，故預測低時 SD 小、易超 3×SD）
v = S.validateBayesianFit(Object.assign({}, goodFit, {
  predictedAtObs: [{ observed: 30, predicted: 8 }],
}));
c('C20', v.status === 'WARNING' && has(v, 'B_RESIDUAL'), '殘差 >3×SD（預測 8 vs 實測 30）→ WARNING');

// ─────────── classifyAUC（B3）───────────
console.log('\n--- AUC 分級 ---');
v = S.classifyAUC(500);
c('C21', v.status === 'OK' && v.allowDoseRecommendation, 'AUC 500 → OK、可建議');

v = S.classifyAUC(700);
c('C22', v.status === 'WARNING' && !v.allowDoseRecommendation && has(v, 'AUC_HIGH'), 'AUC 700 → WARNING、不逕給單行減量');

v = S.classifyAUC(300);
c('C23', v.status === 'WARNING' && v.allowDoseRecommendation && has(v, 'AUC_LOW'), 'AUC 300 → WARNING、仍可建議加量');

v = S.classifyAUC(NaN);
c('C24', v.status === 'BLOCK' && has(v, 'AUC_NONFINITE'), 'AUC NaN → BLOCK');

c('C24b', S.auc600Management().length >= 4, 'AUC>600 結構化處置清單 ≥4 項');

// ─────────── evaluateDataQuality ───────────
console.log('\n--- 資料品質 ---');
v = S.evaluateDataQuality({ nLevels: 1 }, 3);
c('C25', v.confidence === 'Moderate' && has(v, 'DQ_SINGLE_LEVEL'), '單點 → Moderate 信心');

v = S.evaluateDataQuality({ nLevels: 2, steadyState: false }, 3);
c('C26', has(v, 'DQ_NON_STEADY') && v.confidence === 'Low', '非穩態 → Low 信心（L2 shrinkage 0.77）');

v = S.evaluateDataQuality({ nLevels: 2, steadyState: true }, 3);
c('C26b', v.confidence === 'High' && has(v, 'DQ_TWO_LEVEL'), '穩態雙點 → High 信心');

v = S.evaluateDataQuality({ nLevels: 1, steadyState: true }, 3);
c('C26c', v.confidence === 'Moderate' && has(v, 'DQ_SINGLE_LEVEL'), '穩態單點 → Moderate 信心');

v = S.evaluateDataQuality({}, 1);
c('C26d', v.confidence === 'Moderate' && has(v, 'DQ_EMPIRIC'), 'Mode 1 經驗（無實測濃度）→ Moderate 信心');

// ─────────── B4 輸注速率 ───────────
console.log('\n--- 輸注速率 ---');
// 必要輸注時長 = max(60 min, dose÷10 mg/min)：兩條規則的交界在 600 mg
c('C30a', Math.abs(S.requiredInfusionTimeH(500) - 1) < 1e-9, '500mg → 60min 規則主導（1.0h）');
c('C30b', Math.abs(S.requiredInfusionTimeH(600) - 1) < 1e-9, '600mg → 兩規則交界恰為 1.0h');
c('C30c', Math.abs(S.requiredInfusionTimeH(1000) - 1.6667) < 1e-3, '1000mg → 速率規則主導（≈1.67h）');
c('C30d', Math.abs(S.requiredInfusionTimeH(2000) - 3.3333) < 1e-3, '2000mg → ≈3.33h');

v = S.checkInfusionRate(1000, 1);
c('C31a', v.status === 'WARNING' && has(v, 'INFUSION_RATE_HIGH'), '1000mg/1h（16.7 mg/min）→ 警示');
c('C31b', v.allowCalculation && v.allowDoseRecommendation && v.confidence === 'High',
  '速率警示屬給藥安全 → 不擋計算/建議、不降信心');

v = S.checkInfusionRate(1000, 2);
c('C32', v.status === 'OK' && !v.messages.length, '1000mg/2h（8.3 mg/min）→ 無警示');

v = S.checkInfusionRate(500, 1);
c('C33', v.status === 'OK' && !v.messages.length, '500mg/1h（8.3 mg/min，滿足 60min）→ 無警示');

v = S.checkInfusionRate(500, 0.5);
c('C34', v.status === 'WARNING', '500mg/0.5h → 速率合格但違反最短 60min → 仍警示');

v = S.checkInfusionRate(1000, 1.6667);
c('C35', v.status === 'OK', '恰達必要時長（浮點邊界）→ 無警示');

v = S.checkInfusionRate(NaN, 1);
c('C36a', v.status === 'OK' && !v.messages.length, 'dose 非有限 → 空 verdict（交呼叫端驗證）');
v = S.checkInfusionRate(1000, 0);
c('C36b', v.status === 'OK' && !v.messages.length, 'tInf=0 → 空 verdict（不除以零）');

// ─────────── merge / buildSafetyMessages ───────────
console.log('\n--- 合併 ---');
v = S.buildSafetyMessages({ eligibility: { age: 60, dialysis: true }, auc: 700 });
c('C27', v.status === 'WARNING' && v.allowCalculation && !v.allowDoseRecommendation,
  'HD + AUC700 → WARNING、可算但不建議（雙重抑制）');

v = S.buildSafetyMessages({ eligibility: { age: 10 }, auc: 500 });
c('C28', v.status === 'BLOCK' && !v.allowCalculation && !v.allowDoseRecommendation, '小兒 + 任何 → BLOCK、全禁');

v = S.buildSafetyMessages({ eligibility: { age: 65 }, auc: 500, dataQuality: { input: { nLevels: 2 }, mode: 3 } });
c('C29', v.status === 'OK' && v.confidence === 'High' && v.allowDoseRecommendation, '正常雙點案 → OK/High/可建議');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
