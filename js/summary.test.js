/* summary.test.js — 臨床摘要分層行為驗證（S-cases）
 * node js/summary.test.js
 *
 * 驗的是「摘要如何呈現既有結果」，不驗 PK 數值本身（那走 pk/bayes test 與 L2）。
 * 所有 safety verdict 一律由真正的 safety.js 產生，不手寫假 verdict——
 * 否則測到的只是本測試檔自己的假設，安全層改了也不會轉紅。
 */
const S = require('./safety.js');
const SUM = require('./summary.js');

let pass = 0, fail = 0;
function c(id, cond, desc) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${desc}`);
  cond ? pass++ : fail++;
}
const inText = (txt, s) => String(txt).indexOf(s) >= 0;

// 現行 1000 mg q12h；主推薦一律用 750 mg（與現行不同），
// 讓「BLOCK 時不得出現具體新劑量」可用「文中不得出現 750」精確驗證。
function mkResult(over) {
  return Object.assign({
    regimenCurrent: { dose: 1000, tau: 12, tInf: 1, dailyMg: 2000, nDose: 5 },
    currentExposure: { auc24: 500, peak: 30.2, trough: 12.5 },
    auc24: 500, mic: 1, aucOverMic: 500, targetAuc: 500,
    recommend: { dose: 750, tau: 12, dailyMg: 1500, auc24: 513, peak: 27.4, trough: 12.1 },
    alternatives: [
      { dose: 750, tau: 12, dailyMg: 1500, auc24: 513, peak: 27.4, trough: 12.1, isCurrent: true },
      { dose: 1500, tau: 24, dailyMg: 1500, auc24: 513, peak: 34.1, trough: 6.2 },
    ],
    confidenceFactors: [],
    patient: '65歲 男，70kg / 170cm，SCr 1.0 mg/dL',
    technical: {
      method: '雙點反算（Sawchuk-Zaske）',
      lines: ['ke 0.1155 /h、t½ 6.0 h、Vd 49.0 L、CL 5.66 L/h'],
      formula: 'AUC_τ = 輸注梯形 + 消除對數梯形',
    },
  }, over || {});
}

// ─────────── 1. AUC 落於目標：達標、不做不必要調整 ───────────
console.log('--- AUC 判讀 ---');
let sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 500 });
let sum = SUM.buildClinicalSummary(mkResult({ auc24: 500 }), sf, 2);
let plan = SUM.buildClinicalPlan(sum);
c('S01', sum.status.key === 'ok' && sum.status.label === '達標' && !sum.blocked,
  'AUC 500 → 狀態「達標」、未封鎖');
c('S02', sum.recommendation.kind === 'maintain' && sum.recommendation.regimenText === '1000 mg q12h',
  '達標 → 建議維持現行方案，不推不必要的新劑量');
c('S03', !inText(plan, '750'), '達標時臨床簡版不出現外推的新劑量（750）');
c('S04', inText(plan, '1000 mg IV q12h'), '臨床簡版以病歷格式列出現行 regimen');

// ─────────── 2. AUC < 400：低於目標 + 主要建議方案 ───────────
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 320 });
sum = SUM.buildClinicalSummary(mkResult({
  auc24: 320,
  recommend: { dose: 1250, tau: 12, dailyMg: 2500, auc24: 505, peak: 35.6, trough: 15.4 },
}), sf, 2);
plan = SUM.buildClinicalPlan(sum);
c('S05', sum.status.key === 'low' && !sum.blocked && sum.recommendation.kind === 'adjust',
  'AUC 320 → 低於目標、仍可建議調整');
c('S06', sum.recommendation.regimenText === '1250 mg q12h'
  && Math.round(sum.recommendation.auc24) === 505
  && sum.recommendation.peak === 35.6 && sum.recommendation.trough === 15.4,
  '低於目標 → 摘要帶出主推薦方案與其預估 AUC／peak／trough');
c('S07', inText(plan, 'Vancomycin 1250 mg IV q12h') && inText(plan, 'peak 35.6') && inText(plan, 'trough 15.4'),
  '臨床簡版含建議 regimen 與預估暴露量');

// ─────────── 3. AUC > 600：高於目標 + 既有 safety 處置 ───────────
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 684 });
sum = SUM.buildClinicalSummary(mkResult({ auc24: 684 }), sf, 2);
plan = SUM.buildClinicalPlan(sum);
c('S08', sum.status.key === 'high' && sum.blocked && sum.blockedLabel === '暫不建議調整',
  'AUC 684 → 高於目標，且依 safety 封鎖劑量建議');
c('S09', sum.managementSteps.length === S.auc600Management().length
  && sum.managementSteps[0] === S.auc600Management()[0],
  'AUC>600 的結構化處置直接取自 safety 層，未在摘要另寫一份');
c('S10', !inText(plan, '750') && inText(plan, '目前無法安全產生具體劑量建議'),
  'AUC>600 → 臨床簡版不出現具體新劑量');

// ─────────── 4. AKI：依各模式既有規則 ───────────
console.log('\n--- 聲明與閘門 ---');
sf = S.buildSafetyMessages({ mode: 1, eligibility: { age: 65, declaredAKI: true }, dataQuality: { input: {}, mode: 1 } });
sum = SUM.buildClinicalSummary(mkResult({
  regimenCurrent: null, currentExposure: null, auc24: 498,
  recommend: { dose: 750, tau: 12, dailyMg: 1500, auc24: 498, peak: 27.4, trough: 12.1 },
}), sf, 1);
plan = SUM.buildClinicalPlan(sum);
c('S11', !sum.blocked && sum.recommendation.kind === 'start' && inText(plan, '750 mg IV q12h'),
  'Mode 1 + AKI → 仍給起始劑量（沿用 safety 的經驗起始語意）');
c('S12', sum.confidence === 'Low' && inText(plan, '腎功能'),
  'Mode 1 + AKI → 信心降 Low，且注意事項提及腎功能');
c('S13', sum.monitoring.some((m) => inText(m, '24 小時')),
  'Mode 1 + AKI → 監測建議為提早複驗（條件式，不虛構日期）');

sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, declaredAKI: true }, auc: 320 });
sum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }), sf, 2);
plan = SUM.buildClinicalPlan(sum);
c('S14', sum.blocked && !inText(plan, '750') && sum.blockedReasons.some((x) => inText(x, '腎功能')),
  'Mode 2 + AKI → 封鎖具體新劑量，並明列成因');
c('S15', sum.monitoring.some((m) => inText(m, '腎功能')) && sum.monitoring.length > 0,
  'BLOCK 亦有明確下一步，不只顯示「無法計算」');

// ─────────── 5. 採血時間不可靠 → 不得輸出具體新劑量 ───────────
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, declaredUnreliableSampleTiming: true }, auc: 320 });
sum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }), sf, 2);
plan = SUM.buildClinicalPlan(sum);
c('S16', sum.blocked && !inText(plan, '750') && sum.blockedReasons.some((x) => inText(x, '採血時間')),
  '採血時間不可靠 → 不輸出具體新劑量（safety 已升級為封鎖）');
c('S17', inText(plan, '320'), '採血時間不可靠時，量測／估算的 AUC 仍照常顯示（與外推劑量分離）');

// ─────────── 6. HD → 不得輸出主動個體化劑量建議 ───────────
sf = S.buildSafetyMessages({
  eligibility: { age: 65, dialysis: true },
  dataQuality: { input: { nLevels: 2, steadyState: true }, mode: 3 },
  auc: 320,
});
sum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }), sf, 3);
plan = SUM.buildClinicalPlan(sum);
c('S18', sum.blocked && !inText(plan, '750') && sum.blockedReasons.some((x) => inText(x, '透析')),
  'HD → 不輸出具體劑量建議，成因標明透析');
c('S19', sum.monitoring.some((m) => inText(m, '透析')), 'HD → 監測建議含透析後追蹤');

// ─────────── 7. Bayesian fit failure → 不得輸出具體新劑量 ───────────
sf = S.buildSafetyMessages({
  eligibility: { age: 65 },
  bayesFit: { converged: false, eta: { cl: 0 }, predictedAtObs: [] },
});
sum = SUM.buildClinicalSummary(mkResult({ auc24: 500 }), sf, 3);
plan = SUM.buildClinicalPlan(sum);
c('S20', !sum.canCalculate && sum.status.key === 'insufficient' && sum.blocked,
  'Bayesian 未收斂 → 狀態「資料不足」、封鎖');
c('S21', !inText(plan, '750') && sum.recommendation.regimen === null,
  'Bayesian 擬合失敗 → 摘要與 Plan 皆無具體新劑量');

// ─────────── 8. BLOCK 時 clinical Plan 不得含任何具體新 regimen ───────────
console.log('\n--- BLOCK / WARNING 的兩版文字 ---');
const blockCases = [
  // AUC 一律取 320（低於目標）：閘門若失效，摘要必然改推 750 mg —— 讓 S23 真的測得到東西。
  ['AKI', { mode: 2, eligibility: { age: 65, declaredAKI: true }, auc: 320 }, 2],
  ['採血時間', { mode: 2, eligibility: { age: 65, declaredUnreliableSampleTiming: true }, auc: 320 }, 2],
  ['HD', { eligibility: { age: 65, dialysis: true }, auc: 320 }, 3],
  ['AUC>600', { mode: 2, eligibility: { age: 65 }, auc: 684 }, 2],
  ['小兒', { mode: 2, eligibility: { age: 10 }, auc: 320 }, 2],
  ['CRRT', { mode: 2, eligibility: { age: 65, crrt: true }, auc: 320 }, 2],
];
let allBlocked = true, noNewDose = true, hasReason = true;
blockCases.forEach(([name, ctx, mode]) => {
  const v = S.buildSafetyMessages(ctx);
  const sm = SUM.buildClinicalSummary(mkResult({ auc24: ctx.auc }), v, mode);
  const p = SUM.buildClinicalPlan(sm);
  if (!sm.blocked) { allBlocked = false; console.log(`      ↳ ${name} 未封鎖`); }
  if (inText(p, '750') || inText(p, '建議考慮調整為') || sm.recommendation.regimen !== null) {
    noNewDose = false; console.log(`      ↳ ${name} 洩漏新劑量`);
  }
  // 成因不得退化成 generic 字串——GATE_LABEL 缺對映時會轉紅
  if (sm.blockedReasons.some((x) => x === '本案安全閘門已擋下劑量建議')) {
    hasReason = false; console.log(`      ↳ ${name} 成因未命名（GATE_LABEL 缺對映）`);
  }
});
c('S22', allBlocked, '六種閘門情境皆判為 BLOCK');
c('S23', noNewDose, 'BLOCK 時 clinical Plan 一律不含具體新 regimen');
c('S24', hasReason, 'BLOCK 成因皆有具名對映（非 generic 退回值）');

// ─────────── 9. WARNING 時 caveat 須出現在摘要與 clinical Plan ───────────
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, pregnant: true }, auc: 500 });
sum = SUM.buildClinicalSummary(mkResult({ auc24: 500 }), sf, 2);
plan = SUM.buildClinicalPlan(sum);
c('S25', sf.status === 'WARNING' && !sum.blocked && sum.recommendation.kind === 'maintain',
  '懷孕（WARNING、未封鎖）→ 仍顯示建議');
c('S26', sum.limitations.some((x) => inText(x, '懷孕')) && inText(plan, '懷孕'),
  'WARNING 的 caveat 同時出現在摘要限制與 clinical Plan');
const manyWarn = S.buildSafetyMessages({
  mode: 2,
  eligibility: { age: 65, ecmo: true, pregnant: true, cysticFibrosis: true, declaredUnreliableDoseTiming: true },
  auc: 320,
});
const sumMany = SUM.buildClinicalSummary(mkResult({ auc24: 320 }), manyWarn, 2);
c('S27', manyWarn.messages.filter((m) => m.severity !== 'info').length > 3
  && sumMany.limitations.length === 3,
  '警示多於 3 條時，摘要限制截斷為 3（§三.E）');

// info 級訊息不應污染摘要限制區
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 500 });
sum = SUM.buildClinicalSummary(mkResult({ auc24: 500 }), sf, 2);
c('S28', sum.limitations.length === 0, '無 warn/block 時摘要不列限制（AUC_OK 為 info，不重複顯示）');

// ─────────── 10. 技術完整版仍含必要 PK 與模型資訊 ───────────
console.log('\n--- 技術完整版 ---');
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, pregnant: true }, auc: 320 });
const res = mkResult({ auc24: 320 });
const tech = SUM.buildTechnicalReport(res, sf, 2);
c('S29', inText(tech, 'ke 0.1155') && inText(tech, 'CL 5.66'), '技術版含 PK 參數');
c('S30', inText(tech, 'Sawchuk-Zaske') && inText(tech, res.technical.formula), '技術版含方法與計算式');
c('S31', inText(tech, 'E_PREGNANT') && inText(tech, 'AUC_LOW'), '技術版含完整 safety messages（含 code）');
c('S32', inText(tech, `資料信心：${sf.confidence}`) && inText(tech, '可出劑量建議'),
  '技術版含 confidence 與閘門旗標');
c('S33', inText(tech, '1500 mg q24h') || inText(tech, '1500 mg q12h'), '技術版含候選方案');
c('S34', inText(tech, '病人：65歲'), '技術版含病人基本資料');

const techBlocked = SUM.buildTechnicalReport(
  mkResult({ auc24: 684 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 684 }), 2);
c('S35', inText(techBlocked, '外推方案（本案不可直接採用') && inText(techBlocked, '主要建議：不輸出'),
  'BLOCK 時技術版仍列外推方案，但明確標示不可直接採用');

// ─────────── 11. 格式規則（§八）───────────
console.log('\n--- 格式 ---');
sum = SUM.buildClinicalSummary(mkResult({ auc24: 512.7 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 512.7 }), 2);
plan = SUM.buildClinicalPlan(sum);
c('S36', inText(plan, '513 mg·h/L') && !inText(plan, '512.7'), 'AUC 顯示為整數且帶單位');
c('S37', SUM.regimenText({ dose: 750, tau: 12 }) === '750 mg q12h'
  && SUM.regimenChartText({ dose: 750, tau: 12 }) === 'Vancomycin 750 mg IV q12h',
  'regimen 格式統一（畫面／病歷兩式）');
sum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 320 }), 2);
plan = SUM.buildClinicalPlan(sum);
c('S38', inText(plan, 'peak 27.4 mg/L') && inText(plan, 'trough 12.1 mg/L'),
  'peak／trough 一位小數且帶單位');
c('S39', inText(plan, '建議：') && inText(plan, '預估 AUC24'),
  '「建議」與「預估」分別標示，避免模型預測被誤認為醫囑');
c('S40', plan.indexOf('評估：') < plan.indexOf('建議：')
  && plan.indexOf('建議：') < plan.indexOf('監測：')
  && plan.indexOf('監測：') < plan.indexOf('注意：'),
  '順序固定：判讀 → 建議 → 預估 → 監測 → 限制');

// ─────────── 12. 非穩態投影標示 ───────────
sf = S.buildSafetyMessages({
  eligibility: { age: 65 },
  dataQuality: { input: { nLevels: 1, steadyState: false }, mode: 3 },
  auc: 480,
});
sum = SUM.buildClinicalSummary(mkResult({ auc24: 480, aucIsProjection: true }), sf, 3);
c('S41', inText(sum.current.aucLabel, '穩態投影') && sum.confidence === 'Low',
  '非穩態 → AUC 標為穩態投影、信心 Low');
c('S42', sum.limitations.some((x) => inText(x, '穩態投影')),
  '非穩態的限制出現在摘要');

// ─────────── 13. 自訂試算附註：BLOCK 時臨床簡版不得帶具體劑量 ───────────
// CR-1 的迴歸：違規原本發生在 ui.js 拿到 buildClinicalPlan() 回傳值「之後」才附加，
// 因此只測 buildClinicalPlan 的 S23 全綠也攔不到。附加邏輯已抽成純函式，改測它。
console.log('\n--- 自訂試算附註 ---');
const custom = { dose: 1750, tau: 24, tInf: 2, dailyMg: 1750, auc24: 640, peak: 41.2, trough: 8.3 };
const sumOpen = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 320 }), 2);
const sumBlk = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, declaredAKI: true }, auc: 320 }), 2);

const cliOpen = SUM.appendCustomSimulation('PLAN', custom, sumOpen, 'clinical');
c('S43', !sumOpen.blocked && inText(cliOpen, '1750 mg q24h') && inText(cliOpen, 'AUC24 640'),
  '閘門開啟 → 臨床簡版照常附上自訂試算的劑量與暴露量');

const cliBlk = SUM.appendCustomSimulation('PLAN', custom, sumBlk, 'clinical');
c('S44', sumBlk.blocked
  && !inText(cliBlk, '1750') && !inText(cliBlk, 'q24h') && !inText(cliBlk, '640')
  && !inText(cliBlk, '41.2') && !inText(cliBlk, '8.3'),
  'BLOCK → 臨床簡版的自訂試算附註不得含任何劑量、間隔或預估暴露量');
c('S45', inText(cliBlk, '曾執行自訂試算') && inText(cliBlk, '腎功能'),
  'BLOCK → 仍如實告知曾試算，並帶出閘門成因（不是靜默吞掉）');

const techBlk = SUM.appendCustomSimulation('TECH', custom, sumBlk, 'technical');
c('S46', inText(techBlk, '1750 mg q24h') && inText(techBlk, '此試算同不可靠')
  && inText(techBlk, '腎功能'),
  'BLOCK → 技術完整版保留數值供覆核，但標明閘門成因與不可靠');
c('S47', SUM.appendCustomSimulation('PLAN', null, sumBlk, 'clinical') === 'PLAN'
  && SUM.appendCustomSimulation('PLAN', null, sumOpen, 'technical') === 'PLAN',
  '未執行自訂試算時原樣返回，不插入空附註');
c('S48', !inText(SUM.appendCustomSimulation('PLAN', custom, sumOpen, 'clinical'), '輸注速率過快')
  && inText(SUM.appendCustomSimulation('PLAN',
    Object.assign({ rateNote: '輸注速率過快：X' }, custom), sumOpen, 'clinical'), '輸注速率過快：X'),
  '輸注速率提示由呼叫端傳入，有才顯示');

// ─────────── 14. verdict 缺漏時 fail-closed（CR-2）───────────
console.log('\n--- 安全邊界預設值 ---');
const noVerdict = SUM.buildClinicalSummary(mkResult({ auc24: 320 }), undefined, 2);
c('S49', noVerdict.blocked && !noVerdict.canCalculate
  && noVerdict.recommendation.regimen === null
  && !inText(SUM.buildClinicalPlan(noVerdict), '750'),
  '完全沒有 verdict → 視為不可計算、不出具體劑量（不得 fail-open）');
const partialVerdict = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  { status: 'BLOCK', confidence: 'Low', messages: [] }, 2);
c('S50', partialVerdict.blocked && !partialVerdict.canCalculate
  && !inText(SUM.buildClinicalPlan(partialVerdict), '750'),
  'verdict 缺 allowCalculation／allowDoseRecommendation 欄位 → 同樣 fail-closed');
const realVerdict = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 320 });
c('S51', typeof realVerdict.allowCalculation === 'boolean'
  && typeof realVerdict.allowDoseRecommendation === 'boolean'
  && !SUM.buildClinicalSummary(mkResult({ auc24: 320 }), realVerdict, 2).blocked,
  'safety.js 一律產出兩個布林，fail-closed 不誤傷正常路徑');

// ─────────── 15. classifyLocal 僅限 Mode 1（CR-3）───────────
// safety 未提供 AUC 分級時，Mode 2/3 不得自行以常數重算一份判讀——
// 否則畫面會顯示「高於目標」而閘門仍開，判讀與行為分歧。
const sfNoAuc = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 } });
const m2NoAuc = SUM.buildClinicalSummary(mkResult({ auc24: 684 }), sfNoAuc, 2);
c('S52', m2NoAuc.status.key === 'insufficient',
  'Mode 2 且 safety 未給 AUC 分級 → 判讀為「資料不足」，不以常數重算');
const sfM1 = S.buildSafetyMessages({ mode: 1, eligibility: { age: 65 }, dataQuality: { input: {}, mode: 1 } });
c('S53', SUM.buildClinicalSummary(mkResult({ auc24: 684 }), sfM1, 1).status.key === 'high'
  && SUM.buildClinicalSummary(mkResult({ auc24: 498 }), sfM1, 1).status.key === 'ok'
  && !SUM.buildClinicalSummary(mkResult({ auc24: 498 }), sfM1, 1).blocked,
  'Mode 1 保留常數退回判讀（經驗起始不送 classifyAUC），且不影響閘門');

// ─────────── 16. 無法計算時的摘要（CR-5）───────────
console.log('\n--- 計算失敗摘要 ---');
const fatal = SUM.buildFatalSummary(['ke 為非有限值', '兩點濃度未遞減'], null, 2);
const fatalPlan = SUM.buildClinicalPlan(fatal);
c('S54', fatal.blocked && fatal.current === null && fatal.status.key === 'insufficient'
  && fatal.recommendation.regimen === null,
  '計算失敗摘要：無現況區、無建議、狀態為資料不足');
c('S55', fatal.blockedReasons.length === 2 && fatal.monitoring.length > 0,
  '計算失敗摘要必含原因與明確下一步（§八.8）');
c('S56', inText(fatalPlan, 'ke 為非有限值') && !inText(fatalPlan, '評估：'),
  '計算失敗時 Plan 仍可組出（跳過評估段，不吐 undefined）');
c('S57', SUM.buildFatalSummary([], [], 3).blockedReasons.length === 1
  && SUM.buildFatalSummary([], [], 3).monitoring.length === 1,
  '未給原因／下一步時退回通用文字，不留空白區塊');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
