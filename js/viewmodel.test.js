/* viewmodel.test.js — PK 結果 → 摘要契約的攤平驗證（V-cases）
 * node js/viewmodel.test.js
 *
 * 這層是「數值 → 臨床摘要」的唯一橋樑：把 currentExposure 與 recommend 填反、
 * 漏設 aucIsProjection，pk/bayes 測試全部不會轉紅，畫面卻已經給錯劑量。
 * 因此一律用**真正的** PK / BAYES 回傳當輸入，不手寫假結果——
 * 否則測到的只是本檔自己的假設，上游改了欄位名也不會被發現。
 */
const PK = require('./pk.js');
const BAYES = require('./bayes.js');
const C = require('./constants.js');
const VM = require('./viewmodel.js');
const SUM = require('./summary.js');
const S = require('./safety.js');
const VANCO = C.VANCO;

let pass = 0, fail = 0;
function c(id, cond, desc) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${desc}`);
  cond ? pass++ : fail++;
}
const inText = (t, s) => String(t).indexOf(s) >= 0;
const near = (a, b, eps) => isFinite(a) && Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps);

// ─────────── Mode 1：經驗起始 ───────────
console.log('--- Mode 1 view-model ---');
const e = PK.empiricDosing({
  age: 65, heightCm: 170, tbw: 70, scr: 1.0, sexMale: true,
  criticallyIll: true, targetAuc: 500, clModel: 'matzke',
});
const vE = VM.buildEmpiricViewModel({
  r: e, targetAuc: 500, icu: true,
  declared: { declaredAKI: false, pregnant: true, cysticFibrosis: false },
  demo: { age: 65, sexLabel: '男', tbw: 70, heightCm: 170, scr: 1.0 },
});
c('V01', vE.regimenCurrent === null && vE.currentExposure === null,
  'Mode 1 無現行方案：regimenCurrent／currentExposure 皆為 null');
c('V02', vE.recommend.dose === e.maintenanceDose && vE.recommend.tau === e.maintenanceInterval
  && near(vE.recommend.auc24, e.predictedAuc24) && near(vE.recommend.peak, e.predictedPeak)
  && near(vE.recommend.trough, e.predictedTrough),
  '建議方案的劑量與預估暴露量逐欄對應 empiricDosing 的輸出');
c('V03', near(vE.auc24, e.predictedAuc24) && inText(vE.aucLabel, '預估'),
  '摘要 AUC 取預測值且標為「預估」（非量測）');
c('V04', vE.loading && vE.loading.dose === e.loadingDose,
  'ICU 勾選 → 帶出負荷劑量');
c('V05', VM.buildEmpiricViewModel({
  r: e, targetAuc: 500, icu: false, declared: {}, demo: {},
}).loading === null, '非 ICU → 不帶負荷劑量');
c('V06', vE.confidenceFactors.length === 1 && vE.confidenceFactors[0] === '懷孕',
  '影響因子只列實際勾選的聲明');
c('V07', inText(vE.patient, '65歲 男') && inText(vE.patient, 'SCr 1'),
  '病人摘要含年齡／性別／SCr');
c('V08', vE.technical.lines.some((x) => inText(x, 'Cockcroft-Gault'))
  && vE.technical.lines.some((x) => inText(x, '負荷劑量')),
  '技術行含 CrCl 與負荷劑量（ICU）');
const vECrass = VM.buildEmpiricViewModel({
  r: PK.empiricDosing({
    age: 65, heightCm: 170, tbw: 110, scr: 1.0, sexMale: true,
    criticallyIll: true, targetAuc: 500, clModel: 'crass',
  }),
  targetAuc: 500, icu: true, declared: {}, demo: {},
});
c('V09', inText(vECrass.technical.method, 'Crass') && inText(vECrass.technical.clLabel, 'Crass')
  && inText(vE.technical.method, 'Matzke'),
  'CL 模型標示隨 r.clModel 切換（Matzke／Crass）');

// ─────────── Mode 2：雙點反算 ───────────
console.log('\n--- Mode 2 view-model ---');
// 刻意取「現行暴露不足、建議劑量必然不同」的案例（現行 500 mg → 建議 1000 mg），
// 否則若建議劑量恰等於現行劑量，兩組暴露量相同，V12–V14 就算填反也不會轉紅。
const aIn = { dose: 500, tau: 12, tInf: 1, c1: 15, t1: 2, c2: 6, t2: 11, mic: 1 };
const a = PK.twoLevelAUC(aIn);
const recOpt = a.intervalOptions.find((o) => o.intervalH === aIn.tau);
const vA = VM.buildTwoLevelViewModel({ r: a, input: aIn, recOpt, declared: {} });
c('V10', a.ok, '前置：twoLevelAUC 反算成功');
c('V11', vA.regimenCurrent.dose === aIn.dose && vA.regimenCurrent.tau === aIn.tau
  && near(vA.regimenCurrent.dailyMg, a.tddCurrent) && recOpt.doseMg !== aIn.dose,
  '現行方案取自使用者輸入與 tddCurrent（且本案建議劑量確與現行不同）');
c('V12', near(vA.currentExposure.auc24, a.auc24) && near(vA.currentExposure.peak, a.cMaxTrue)
  && near(vA.currentExposure.trough, a.cMinTrue),
  '現行暴露量取「量測反算」的 AUC／真峰／真谷');
c('V13', near(vA.recommend.auc24, recOpt.projectedAuc24)
  && near(vA.recommend.peak, recOpt.projectedPeak)
  && near(vA.recommend.trough, recOpt.projectedTrough),
  '建議暴露量取「外推投影」值');
c('V14', vA.currentExposure.auc24 < vA.recommend.auc24
  && vA.currentExposure.peak < vA.recommend.peak
  && vA.currentExposure.trough < vA.recommend.trough,
  '現行與建議的暴露量未互換（本案現行不足，三個數值皆須低於建議方案）');
c('V15', vA.alternatives.length === a.intervalOptions.length
  && vA.alternatives.filter((o) => o.isCurrent).length === 1
  && vA.alternatives.find((o) => o.isCurrent).tau === aIn.tau,
  '替代方案完整帶出，且只有一列標為現行間隔');
c('V16', !vA.aucIsProjection && near(vA.auc24, a.auc24),
  'Mode 2 為穩態量測反算：AUC 不標為投影');
const vADist = VM.buildTwoLevelViewModel({
  r: a, input: Object.assign({}, aIn, { t1: 1.5 }), recOpt,
  declared: { declaredAKI: true, declaredUnreliableSampleTiming: true },
});
c('V17', vADist.confidenceFactors.indexOf('峰採樣接近分布相') === 0
  && vADist.confidenceFactors.indexOf('AKI') > 0
  && vADist.confidenceFactors.indexOf('採血時間不可靠') > 0,
  '峰採樣時相由 t1−tInf 推得，與勾選聲明併入影響因子');
c('V18', !vA.confidenceFactors.length,
  '未勾選任何聲明且時相合理 → 無影響因子（不把正面敘述誤標為風險）');
c('V19', inText(vA.technical.formula, 'ke = ln(') && inText(vA.technical.formula, 'AUC₂₄ = AUC_τ'),
  '技術版計算式由 view-model 產生（第三層與複製報告共用同一份）');
c('V20', inText(SUM.buildTechnicalReport(vA,
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: a.auc24 }), 2), 'ke = ln('),
  '「複製完整 PK 報告」確實含計算式（TG-4：欄位不再是死分支）');

// ─────────── Mode 3：Bayesian MAP ───────────
console.log('\n--- Mode 3 view-model ---');
const bDose = 1000, bTau = 12, bTinf = 1, bN = 5;
const doses = []; for (let n = 0; n < bN; n++) doses.push({ time: n * bTau, dose: bDose, tInf: bTinf });
const lastStart = (bN - 1) * bTau;
// 同 Mode 2 的理由：取暴露不足的濃度，讓建議劑量（1500）確與現行（1000）不同，
// 否則 curExp 與 recExp 相同，V22 就算把兩者互換也不會轉紅。
const levels = [{ conc: 14, tRel: 2 }, { conc: 5, tRel: 11.5 }];
const b = BAYES.bayesianMAP({
  cov: { age: 65, weightKg: 70, scr: 1.0, sexMale: true, dialysis: false },
  tbw: 70, doses, obs: levels.map((l) => ({ time: lastStart + l.tRel, conc: l.conc })),
  currentDailyDose: bDose * (24 / bTau),
});
const pk3 = { cl: b.cl, vc: b.vc, vp: b.vp, q: b.q };
const curExp = BAYES.steadyStateExposure(bDose, bTau, bTinf, pk3);
const recDose = PK.roundDose(b.recommendTDD(500) * (bTau / 24), 250);
const recExp = BAYES.steadyStateExposure(recDose, bTau, bTinf, pk3);
const mkB = (over) => VM.buildBayesViewModel(Object.assign({
  r: b, dose: bDose, tau: bTau, tInf: bTinf, nDose: bN, levels,
  steadyState: true, mic: 1, targetAuc: 500, recDose, recExp, curExp,
  declared: {}, demo: { age: 65, sexLabel: '男', tbw: 70, heightCm: 170, scr: 1.0, dialysis: false },
}, over || {}));
const vB = mkB();
c('V21', b.converged, '前置：Bayesian MAP 收斂');
c('V22', recDose !== bDose
  && near(vB.currentExposure.peak, curExp.peak) && near(vB.currentExposure.trough, curExp.trough)
  && near(vB.recommend.peak, recExp.peak) && near(vB.recommend.trough, recExp.trough)
  && vB.currentExposure.peak < vB.recommend.peak,
  '現行／建議的峰谷分別取自各自的 steadyStateExposure，未互換');
c('V23', near(vB.auc24, b.auc24Current) && vB.recommend.dose === recDose
  && vB.recommend.tau === bTau,
  '摘要 AUC 為現行方案的 MAP 估計；建議沿用同間隔');
c('V24', near(vB.aucOverMic, b.auc24Current / 1) && vB.mic === 1, 'AUC/MIC 以輸入 MIC 計算');
c('V25', mkB({ steadyState: false }).aucIsProjection === true
  && vB.aucIsProjection === false,
  '非穩態 → aucIsProjection 為 true（漏設會讓 AUC 被當成當日實際暴露）');
c('V26', mkB({ steadyState: false }).technical.lines.some((x) => inText(x, '非穩態'))
  && vB.technical.lines.some((x) => inText(x, '近穩態')),
  '取樣狀態同步反映在技術行');
c('V27', mkB({ levels: [levels[0]] }).confidenceFactors.indexOf('單一濃度') >= 0
  && vB.confidenceFactors.indexOf('單一濃度') < 0,
  '單點取樣列為影響因子，雙點不列');
c('V28', mkB({
  demo: { age: 65, sexLabel: '男', tbw: 70, heightCm: 170, scr: 1.0, dialysis: true },
}).confidenceFactors.indexOf('血液透析') >= 0,
  '透析狀態進入影響因子');
// 兩側都要跨過門檻才測得到——只比對「同一條式子」在單一案例上的結果是恆真斷言。
c('V29', vB.recommend.impractical === false
  && mkB({ recDose: VANCO.MAINT_PERDOSE_PRACTICAL_MAX }).recommend.impractical === false
  && mkB({ recDose: VANCO.MAINT_PERDOSE_PRACTICAL_MAX + 250 }).recommend.impractical === true,
  `單次過大旗標以 MAINT_PERDOSE_PRACTICAL_MAX（${VANCO.MAINT_PERDOSE_PRACTICAL_MAX} mg）為界，門檻值本身不算過大`);
c('V30', inText(vB.technical.formula, 'TVCL') && inText(vB.technical.formula, 'AUC₂₄ = 每日總量'),
  '技術版含 Goti 先驗代入與 AUC 計算式');
c('V31', vB.alternatives.length === 0,
  'Mode 3 不預先列候選方案（替代方案改由自訂試算產生）');

// ─────────── 與 summary.js 的契約銜接 ───────────
console.log('\n--- 契約銜接 ---');
const sfA = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: a.auc24 });
const smA = SUM.buildClinicalSummary(vA, sfA, 2);
c('V32', smA.status.key !== 'insufficient' && smA.current.regimen === vA.regimenCurrent,
  'Mode 2 view-model 可直接被 buildClinicalSummary 消費（欄位名相符）');
const smB = SUM.buildClinicalSummary(vB, S.buildSafetyMessages({
  eligibility: { age: 65 },
  dataQuality: { input: { nLevels: 2, steadyState: true }, mode: 3 },
  auc: b.auc24Current,
}), 3);
c('V33', smB.status.key !== 'insufficient' && isFinite(smB.current.auc24),
  'Mode 3 view-model 同樣可被消費，AUC 為有限值');
const smE = SUM.buildClinicalSummary(vE, S.buildSafetyMessages({
  mode: 1, eligibility: { age: 65, pregnant: true }, dataQuality: { input: {}, mode: 1 },
}), 1);
c('V34', smE.recommendation.kind === 'start' && smE.recommendation.regimen === vE.recommend,
  'Mode 1 view-model → 摘要判為「起始建議」');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
