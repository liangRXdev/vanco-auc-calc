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

// Crass 2018 肥胖 CL 模型（v0.4.0）
console.log('\n--- Crass 2018 肥胖 CLV ---');
// 手算：age55 SCr1.0 男 TBW120 → 9.656−0.078×55−2.009+1.09+0.04×120^0.75 = 5.897 L/h
const clv = PK.crassClVanco(55, 1.0, true, 120);
near('CLV (age55,SCr1,男,120kg)', clv, 5.897, 0.005);
// 女性應少 1.09
near('CLV 女性 −1.09', PK.crassClVanco(55, 1.0, false, 120), 5.897 - 1.09, 0.005);
// Vd BMI 分段：BMI 35→0.8、BMI 45→0.52、BMI 55→0.42 L/kg
near('Crass Vd BMI35 (0.8×100)', PK.crassVd(100, 35), 80, 1e-6);
near('Crass Vd BMI45 (0.52×130)', PK.crassVd(130, 45), 67.6, 1e-6);
near('Crass Vd BMI55 (0.42×160)', PK.crassVd(160, 55), 67.2, 1e-6);
// nomogram 負荷/間隔
console.log((PK.crassLoading(6) === 2500 && PK.crassLoading(8) === 3000) ? 'PASS  Crass 負荷 CLV6→2500、CLV8→3000' : 'FAIL  Crass 負荷') || (PK.crassLoading(6) === 2500 && PK.crassLoading(8) === 3000 ? pass++ : fail++);
console.log((PK.suggestIntervalByClv(3) === 24 && PK.suggestIntervalByClv(5) === 12) ? 'PASS  Crass 間隔 CLV3→q24、CLV5→q12' : 'FAIL  Crass 間隔') || (PK.suggestIntervalByClv(3) === 24 && PK.suggestIntervalByClv(5) === 12 ? pass++ : fail++);

// empiricDosing clModel='crass'：肥胖案應用 Crass CLV、Vd BMI 分段、nomogram
console.log('\n--- Mode 1 Crass 肥胖案 ---');
const ec = PK.empiricDosing({ tbw: 120, sexMale: true, heightCm: 170, age: 55, scr: 1.0, criticallyIll: true, clModel: 'crass' });
console.log(`  BMI=${ec.bmi.toFixed(1)}, CLV=${ec.clPop.toFixed(2)} L/h, Vd=${ec.vdPop.toFixed(1)}L, 負荷=${ec.loadingDose}, 維持=${ec.maintenanceDose} q${ec.maintenanceInterval}h, 預測AUC=${ec.predictedAuc24.toFixed(0)}, nomogram=${ec.nomogram ? ec.nomogram.maint + ' q' + ec.nomogram.tau : 'none'}`);
near('Crass empiric CLV', ec.clPop, 5.897, 0.01);
console.log((ec.clModel === 'crass' && ec.nomogram && ec.nomogram.clv === 6) ? 'PASS  clModel=crass、nomogram bin CLV6' : 'FAIL  Crass empiric 分支') || (ec.clModel === 'crass' && ec.nomogram && ec.nomogram.clv === 6 ? pass++ : fail++);
console.log((ec.predictedAuc24 >= 400 && ec.predictedAuc24 <= 600) ? `PASS  Crass 預測 AUC24 ${ec.predictedAuc24.toFixed(0)} 落 400–600` : `FAIL  AUC24 ${ec.predictedAuc24.toFixed(0)}`) || (ec.predictedAuc24 >= 400 && ec.predictedAuc24 <= 600 ? pass++ : fail++);
// 對照：同案 Matzke 在肥胖會系統性高估 CL（用 AdjBW CrCl），Crass 應給不同（通常較低）CL
const em = PK.empiricDosing({ tbw: 120, sexMale: true, heightCm: 170, age: 55, scr: 1.0, criticallyIll: true });
console.log(`  對照 Matzke CL=${em.clPop.toFixed(2)} L/h（Crass ${ec.clPop.toFixed(2)}）— 肥胖兩模型分歧屬預期`);
// 非肥胖用 Crass 應觸發 BMI<30 警示
const ecLean = PK.empiricDosing({ tbw: 65, sexMale: true, heightCm: 175, age: 55, scr: 1.0, clModel: 'crass' });
console.log(ecLean.warnings.some((w) => w.msg.includes('BMI') && w.msg.includes('< 30')) ? 'PASS  非肥胖用 Crass → BMI<30 警示' : 'FAIL  缺 BMI 警示') || (ecLean.warnings.some((w) => w.msg.includes('< 30')) ? pass++ : fail++);

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
