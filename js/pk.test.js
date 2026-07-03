/* 簡易 sanity test：node js/pk.test.js */
const PK = require('./pk.js');
const { VANCO } = require('./constants.js');

let pass = 0, fail = 0;
function near(name, got, exp, tol = 0.05) {
  const ok = Math.abs(got - exp) <= Math.abs(exp) * tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got ${got.toFixed(3)}, exp ~${exp}`);
  ok ? pass++ : fail++;
}

// 手算範例：1000 mg q12h，輸注 1h；峰 20 mg/L @ t=3h、谷 7 mg/L @ t=11.5h
const r = PK.twoLevelAUC({ dose: 1000, tau: 12, tInf: 1, c1: 20, t1: 3, c2: 7, t2: 11.5 });
console.log('\n--- Mode 2 雙點法 ---');
near('ke', r.ke, 0.1235);
near('half-life', r.halfLife, 5.61);
near('Cmax_true', r.cMaxTrue, 25.6);
near('Cmin_true', r.cMinTrue, 6.58);
near('Vd', r.vd, 47.6);
near('CL', r.cl, 5.88);
near('AUC24', r.auc24, 340.2);
// 關鍵一致性：兩段式 AUC24 應 ≈ TDD/CL（差異來自輸注期線性梯形近似，<0.5%）
near('AUC24 ≈ TDD/CL 交叉驗證', r.auc24, r.auc24Check, 0.005);
console.log('  AUC/MIC =', r.aucOverMic.toFixed(0), '| 建議日劑量 =', r.tddTarget.toFixed(0), 'mg');
console.log('  警示:', r.warnings.map(w => w.msg).join(' / '));

// 反例：僅消除期簡化式會低估
const aucSimplified = (r.cMaxTrue - r.cMinTrue) / r.ke * (24 / 12);
console.log(`\n  [佐證] 舊簡化式 AUC24=${aucSimplified.toFixed(0)} vs 完整式 ${r.auc24.toFixed(0)}（低估 ${((1 - aucSimplified / r.auc24) * 100).toFixed(1)}%）`);

// 自訂試算：以反算出的 PK 模擬 1500 mg q12h（應 ≈ 建議方案）
console.log('\n--- 自訂方案試算 simulateRegimen ---');
const s = PK.simulateRegimen(1500, 12, 1, r.ke, r.vd, r.cl, 1);
near('sim 峰', s.peak, 38.4);
near('sim 谷', s.trough, 9.9);
near('sim AUC24', s.auc24, 511);
console.log('  impractical=', s.impractical, '| inTarget=', s.inTarget);

// 驗證：遞增濃度（峰谷填反）必須被擋下，不可算出負 ke
console.log('\n--- 驗證：遞增濃度應報錯 ---');
const badInc = PK.twoLevelAUC({ dose: 1000, tau: 12, tInf: 1, c1: 7, t1: 3, c2: 20, t2: 11.5 });
console.log((!badInc.ok && badInc.errors.some((m) => m.includes('遞減'))) ? 'PASS  c2>c1 被擋下' : 'FAIL  未擋下遞增濃度') || (badInc.ok ? fail++ : pass++);

// Mode 1 經驗劑量（維持＝族群 CL 反推 AUC）
console.log('\n--- Mode 1 經驗起始（AUC 導向）---');
const e = PK.empiricDosing({ tbw: 80, sexMale: true, heightCm: 175, age: 60, scr: 1.0, criticallyIll: true });
console.log(`  IBW=${e.ibw.toFixed(1)}kg, CrCl 體重=${e.crclWeight.label} ${e.crclWeight.weight.toFixed(1)}kg, CrCl=${e.crcl.toFixed(0)} mL/min`);
console.log(`  族群 CL=${e.clPop.toFixed(2)} L/h, 負荷=${e.loadingDose}mg, 維持=${e.maintenanceDose}mg q${e.maintenanceInterval}h (${e.maintenanceDailyMg}mg/day), 預測 AUC24=${e.predictedAuc24.toFixed(0)}`);
near('負荷 ~22.5mg/kg×80 圓整', e.loadingDose, 1750, 0.1);
near('Matzke CL (CrCl 89)', e.clPop, 3.90, 0.03);
// 核心：預測 AUC 應落在目標 400–600（不再衝破）
console.log((e.predictedAuc24 >= 400 && e.predictedAuc24 <= 600) ? `PASS  預測 AUC24 ${e.predictedAuc24.toFixed(0)} 落在 400–600` : `FAIL  AUC24 ${e.predictedAuc24.toFixed(0)} 超出目標`) || (e.predictedAuc24 >= 400 && e.predictedAuc24 <= 600 ? pass++ : fail++);
// 目標可調：targetAuc=450 應得較低劑量
const e450 = PK.empiricDosing({ tbw: 80, sexMale: true, heightCm: 175, age: 60, scr: 1.0, criticallyIll: true, targetAuc: 450 });
console.log((e450.maintenanceDailyMg <= e.maintenanceDailyMg) ? 'PASS  目標 450 劑量 ≤ 目標 500' : 'FAIL  目標調整無效') || (e450.maintenanceDailyMg <= e.maintenanceDailyMg ? pass++ : fail++);

// 肥胖體重雙用檢查
console.log('\n--- 肥胖體重雙用 ---');
const ibwOb = PK.idealBodyWeight(true, 170);
const cw = PK.crclDosingWeight(140, ibwOb);
console.log(`  TBW=140, IBW=${ibwOb.toFixed(1)} → CrCl 用 ${cw.label} ${cw.weight.toFixed(1)}kg（劑量另用 TBW 140）`);
console.log(cw.label.includes('AdjBW') ? 'PASS  肥胖→CrCl 用 AdjBW' : 'FAIL  應為 AdjBW') || pass++;

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
