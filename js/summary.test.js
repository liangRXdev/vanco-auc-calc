/* summary.test.js — 臨床摘要分層行為驗證（S-cases）
 * node js/summary.test.js
 *
 * 驗的是「摘要如何呈現既有結果」，不驗 PK 數值本身（那走 pk/bayes test 與 L2）。
 * 所有 safety verdict 一律由真正的 safety.js 產生，不手寫假 verdict——
 * 否則測到的只是本測試檔自己的假設，安全層改了也不會轉紅。
 */
const S = require('./safety.js');
const SUM = require('./summary.js');
const { VANCO } = require('./constants.js');

let pass = 0, fail = 0;
function c(id, cond, desc) {
  console.log(`${cond ? 'PASS' : 'FAIL'}  [${id}] ${desc}`);
  cond ? pass++ : fail++;
}
const inText = (txt, s) => String(txt).indexOf(s) >= 0;
const countText = (txt, s) => String(txt).split(s).length - 1;

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
// 注入 provider 才測得到「有沒有另寫一份」：比對兩次呼叫同一個函式，
// 就算摘要裡複製一份 hard-coded 步驟也照樣相等（TG-2）。
const realMgmt = S.auc600Management;
S.auc600Management = () => ['__STEP_A__', '__STEP_B__'];
const sumInj = SUM.buildClinicalSummary(mkResult({ auc24: 684 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 684 }), 2);
const planInj = SUM.buildClinicalPlan(sumInj);
S.auc600Management = realMgmt;
c('S09', sumInj.managementSteps.length === 2 && sumInj.managementSteps[0] === '__STEP_A__'
  && inText(planInj, '__STEP_B__') && !inText(planInj, '評估延後 / 暫停下一劑'),
  'AUC>600 的結構化處置逐字取自 safety 層（換掉 provider 後摘要與 Plan 同步改變）');
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
// 案例表須涵蓋 GATE_LABEL 的每一個碼（S24b 會逐一核對），否則新增閘門成因時，
// 該成因會從畫面「靜默消失」而非退回 generic 字串——那比顯示不精確更危險。
// AUC 一律取 320（低於目標）：閘門若失效，摘要必然改推 750 mg —— 讓 S23 真的測得到東西。
const CONC = (over) => ({
  levels: Object.assign({ c1: 30, t1: 2, c2: 12, t2: 11 }, (over || {}).levels),
  dosing: Object.assign({ tau: 12, tInf: 1 }, (over || {}).dosing),
  pk: Object.assign({ ke: 0.0833, halfLife: 8.3, auc24: 320 }, (over || {}).pk),
});
const blockCases = [
  ['小兒', { mode: 2, eligibility: { age: 10 }, auc: 320 }, 2],
  ['CRRT', { mode: 2, eligibility: { age: 65, crrt: true }, auc: 320 }, 2],
  ['HD', { eligibility: { age: 65, dialysis: true }, auc: 320 }, 3],
  ['AKI', { mode: 2, eligibility: { age: 65, declaredAKI: true }, auc: 320 }, 2],
  ['採血時間', { mode: 2, eligibility: { age: 65, declaredUnreliableSampleTiming: true }, auc: 320 }, 2],
  ['AUC>600', { mode: 2, eligibility: { age: 65 }, auc: 684 }, 2],
  ['AUC 非有限', { mode: 2, eligibility: { age: 65 }, auc: NaN }, 2],
  ['Bayes 非有限', { eligibility: { age: 65 }, bayesFit: { nonFinite: true, eta: { cl: 0 }, predictedAtObs: [] }, auc: 320 }, 3],
  ['Bayes 未收斂', { eligibility: { age: 65 }, bayesFit: { converged: false, eta: { cl: 0 }, predictedAtObs: [] }, auc: 320 }, 3],
  ['Bayes 不穩定', { eligibility: { age: 65 }, bayesFit: { fitReliable: false, eta: { cl: 0 }, predictedAtObs: [] }, auc: 320 }, 3],
  ['濃度非正', { mode: 2, eligibility: { age: 65 }, concentrations: CONC({ levels: { c1: 0 } }), auc: 320 }, 2],
  ['時序顛倒', { mode: 2, eligibility: { age: 65 }, concentrations: CONC({ levels: { t1: 11, t2: 2 } }), auc: 320 }, 2],
  ['濃度未遞減', { mode: 2, eligibility: { age: 65 }, concentrations: CONC({ levels: { c2: 40 } }), auc: 320 }, 2],
  ['採血在輸注期內', { mode: 2, eligibility: { age: 65 }, concentrations: CONC({ levels: { t1: 0.5 } }), auc: 320 }, 2],
  ['ke 非正', { mode: 2, eligibility: { age: 65 }, concentrations: CONC({ pk: { ke: 0 } }), auc: 320 }, 2],
  ['反算 AUC 非有限', { mode: 2, eligibility: { age: 65 }, concentrations: CONC({ pk: { auc24: NaN } }), auc: 320 }, 2],
];
let allBlocked = true, noNewDose = true, hasReason = true, blockMapped = true;
const seenCodes = new Set();
blockCases.forEach(([name, ctx, mode]) => {
  const v = S.buildSafetyMessages(ctx);
  const sm = SUM.buildClinicalSummary(mkResult({ auc24: ctx.auc }), v, mode);
  const p = SUM.buildClinicalPlan(sm);
  v.messages.forEach((m) => seenCodes.add(m.code));
  if (!sm.blocked) { allBlocked = false; console.log(`      ↳ ${name} 未封鎖`); }
  if (inText(p, '750') || inText(p, '建議考慮調整為') || sm.recommendation.regimen !== null) {
    noNewDose = false; console.log(`      ↳ ${name} 洩漏新劑量`);
  }
  // 成因不得退化成 generic 字串——GATE_LABEL 缺對映時會轉紅
  if (sm.blockedReasons.some((x) => x === '本案安全閘門已擋下劑量建議')) {
    hasReason = false; console.log(`      ↳ ${name} 成因未命名（GATE_LABEL 缺對映）`);
  }
  // block 級訊息若無對映，會從成因清單中靜默消失（不會退回 generic）
  v.messages.filter((m) => m.severity === 'block').forEach((m) => {
    if (!SUM._internal.GATE_LABEL[m.code]) {
      blockMapped = false; console.log(`      ↳ ${name} 的 ${m.code} 無 GATE_LABEL 對映`);
    }
  });
});
c('S22', allBlocked, `${blockCases.length} 種閘門情境皆判為 BLOCK`);
c('S23', noNewDose, 'BLOCK 時 clinical Plan 一律不含具體新 regimen');
c('S24', hasReason, 'BLOCK 成因皆有具名對映（非 generic 退回值）');
c('S24b', blockMapped, '所有 block 級訊息碼都有 GATE_LABEL 對映（新增閘門碼不會靜默消失）');
const unexercised = Object.keys(SUM._internal.GATE_LABEL).filter((k) => !seenCodes.has(k));
c('S24c', unexercised.length === 0,
  `GATE_LABEL 的每個碼都有案例覆蓋${unexercised.length ? '（未覆蓋：' + unexercised.join('、') + '）' : ''}`);

// ─────────── 9. WARNING 時 caveat 須出現在摘要與 clinical Plan ───────────
sf = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, pregnant: true }, auc: 500 });
sum = SUM.buildClinicalSummary(mkResult({ auc24: 500 }), sf, 2);
plan = SUM.buildClinicalPlan(sum);
c('S25', sf.status === 'WARNING' && !sum.blocked && sum.recommendation.kind === 'maintain',
  '懷孕（WARNING、未封鎖）→ 仍顯示建議');
c('S26', inText(sum.recommendation.caveat, '懷孕') && inText(plan, '懷孕')
  && plan.indexOf('懷孕') < plan.indexOf('監測：')
  && countText(plan, '懷孕：') === 1,
  'WARNING 的 caveat 緊鄰建議、同時出現在 clinical Plan，且只出現一次（§四.2＋§八.3）');
c('S26b', !sum.limitations.some((x) => inText(x, '懷孕')),
  '已作為 caveat 呈現的那一項不再重複列進限制區');
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
// 併入懷孕，讓警示有兩條：一條成為建議旁的 caveat、另一條落在「注意：」區，
// S40 的順序才驗得到完整五段（只有一條警示時「注意：」整段不存在）。
sum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, pregnant: true }, auc: 320 }), 2);
plan = SUM.buildClinicalPlan(sum);
c('S38', inText(plan, 'peak 27.4 mg/L') && inText(plan, 'trough 12.1 mg/L'),
  'peak／trough 一位小數且帶單位');
// 只驗兩個詞存在測不到「是否分開」：複製一份把兩者寫在同一行也會過。
// 要驗的是「醫囑格式的 regimen 與模型預測數值不在同一行、且預估行不帶醫囑格式」。
const planLines = plan.split('\n');
const recLine = planLines.find((l) => inText(l, 'Vancomycin') && inText(l, '考慮調整為'));
const estLine = planLines.find((l) => l.indexOf('預估 AUC24') === 0);
c('S39', !!recLine && !!estLine && !inText(estLine, 'Vancomycin')
  && !inText(recLine, '預估') && planLines.indexOf(recLine) < planLines.indexOf(estLine),
  '「建議」與「預估」分屬不同行與不同標籤，預估行不含醫囑格式的 regimen');
c('S40', plan.indexOf('評估：') < plan.indexOf('建議：')
  && plan.indexOf('建議：') < plan.indexOf('※ ')
  && plan.indexOf('※ ') < plan.indexOf('監測：')
  && plan.indexOf('監測：') < plan.indexOf('注意：')
  && plan.indexOf('注意：') > 0,
  '順序固定：判讀 → 建議 → 預估 → caveat → 監測 → 限制');

// ─────────── 12. 非穩態投影標示 ───────────
sf = S.buildSafetyMessages({
  eligibility: { age: 65 },
  dataQuality: { input: { nLevels: 1, steadyState: false }, mode: 3 },
  auc: 480,
});
sum = SUM.buildClinicalSummary(mkResult({ auc24: 480, aucIsProjection: true }), sf, 3);
c('S41', inText(sum.current.aucLabel, '穩態投影') && sum.confidence === 'Low',
  '非穩態 → AUC 標為穩態投影、信心 Low');
c('S42', inText(sum.recommendation.caveat, '穩態投影'),
  '非穩態的限制以 caveat 形式出現在建議旁');

// ─────────── 12b. AUC 邊界（TG-8）───────────
// safety.js 是 `auc > 600` 才 high、`auc < 400` 才 low，故 400 與 600 兩端皆屬達標。
// 這個包含性一旦被改成 >= / <=，會讓邊界個案憑空多出一次劑量調整，值得釘死。
console.log('\n--- AUC 邊界 ---');
const atAuc = (v) => SUM.buildClinicalSummary(mkResult({ auc24: v }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: v }), 2);
c('S43', atAuc(400).status.key === 'ok' && !atAuc(400).blocked
  && atAuc(400).recommendation.kind === 'maintain',
  `AUC 恰 ${VANCO.AUC_TARGET_MIN} → 達標（下界為包含），建議維持現行`);
c('S44', atAuc(399.6).status.key === 'low' && atAuc(399.6).recommendation.kind === 'adjust',
  '略低於下界 → 低於目標並給調整建議（判讀不因四捨五入成 400 而翻面）');
c('S45', atAuc(600).status.key === 'ok' && !atAuc(600).blocked,
  `AUC 恰 ${VANCO.AUC_TARGET_MAX} → 達標且不封鎖（上界為包含）`);
c('S46', atAuc(600.4).status.key === 'high' && atAuc(600.4).blocked,
  '略高於上界 → 高於目標並封鎖劑量建議');
const nan = atAuc(NaN);
c('S47', !nan.canCalculate && nan.status.key === 'insufficient' && nan.blocked
  && inText(nan.current.aucText, '—'),
  'AUC 非有限值 → 資料不足、封鎖，且不吐 NaN 到畫面');

// ─────────── 12c. Mode 1 摘要覆蓋（TG-9）───────────
console.log('\n--- Mode 1 摘要 ---');
const sfM1Plain = S.buildSafetyMessages({ mode: 1, eligibility: { age: 65 }, dataQuality: { input: {}, mode: 1 } });
const m1 = SUM.buildClinicalSummary(mkResult({
  regimenCurrent: null, currentExposure: null, auc24: 463,
  recommend: { dose: 750, tau: 12, dailyMg: 1500, auc24: 463, peak: 27.1, trough: 13.1 },
  loading: { dose: 1500, capped: false },
  aucLabel: '建議方案預估 AUC24',
}), sfM1Plain, 1);
const m1Plan = SUM.buildClinicalPlan(m1);
c('S48', m1.recommendation.kind === 'start' && inText(m1.recommendation.headline, '建議起始')
  && inText(m1Plan, '起始 Vancomycin 750 mg IV q12h'),
  'Mode 1 → 判為「起始」而非「調整」（無現行方案可調整）');
c('S49', inText(m1Plan, '尚無現行方案（經驗起始）') && !inText(m1Plan, '維持現行'),
  'Mode 1 臨床簡版明示無現行方案');
c('S50', inText(m1Plan, '負荷：Vancomycin 1500 mg IV')
  && !inText(SUM.buildClinicalPlan(SUM.buildClinicalSummary(mkResult({
    regimenCurrent: null, currentExposure: null, auc24: 463, loading: null,
  }), sfM1Plain, 1)), '負荷：'),
  '負荷劑量僅在有值時出現於 Plan');
c('S51', m1.confidence === 'Moderate' && m1.monitoring.some((x) => inText(x, '24–48')),
  'Mode 1 信心 Moderate、監測建議為 24–48h 內採濃度驗證');
c('S52', inText(m1.current.aucLabel, '預估') && !inText(m1Plan, '量測'),
  'Mode 1 的 AUC 標為預估（無實測濃度，不得寫成量測值）');
const m1Capped = SUM.buildClinicalSummary(mkResult({
  regimenCurrent: null, currentExposure: null, auc24: 520,
  recommend: { dose: 2000, tau: 12, dailyMg: 4000, auc24: 520, peak: 45.2, trough: 18.9, impractical: true },
  loading: { dose: 3000, capped: true },
}), sfM1Plain, 1);
c('S53', inText(SUM.buildClinicalPlan(m1Capped), '已封頂 3000 mg')
  && m1Capped.recommendation.impractical === true,
  '負荷封頂與單次過大旗標如實帶入 Plan');
const m1AKI = SUM.buildClinicalSummary(mkResult({
  regimenCurrent: null, currentExposure: null, auc24: 463,
  recommend: { dose: 750, tau: 12, dailyMg: 1500, auc24: 463, peak: 27.1, trough: 13.1 },
}), S.buildSafetyMessages({ mode: 1, eligibility: { age: 65, declaredAKI: true }, dataQuality: { input: {}, mode: 1 } }), 1);
c('S54', !m1AKI.blocked && inText(m1AKI.recommendation.caveat, '腎功能'),
  'Mode 1 + AKI → 仍給起始劑量，但 caveat 緊鄰建議標明腎功能變動');

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
c('S55', !sumOpen.blocked && inText(cliOpen, '1750 mg q24h') && inText(cliOpen, 'AUC24 640'),
  '閘門開啟 → 臨床簡版照常附上自訂試算的劑量與暴露量');

const cliBlk = SUM.appendCustomSimulation('PLAN', custom, sumBlk, 'clinical');
c('S56', sumBlk.blocked
  && !inText(cliBlk, '1750') && !inText(cliBlk, 'q24h') && !inText(cliBlk, '640')
  && !inText(cliBlk, '41.2') && !inText(cliBlk, '8.3'),
  'BLOCK → 臨床簡版的自訂試算附註不得含任何劑量、間隔或預估暴露量');
c('S57', inText(cliBlk, '曾執行自訂試算') && inText(cliBlk, '腎功能'),
  'BLOCK → 仍如實告知曾試算，並帶出閘門成因（不是靜默吞掉）');

const techBlk = SUM.appendCustomSimulation('TECH', custom, sumBlk, 'technical');
c('S58', inText(techBlk, '1750 mg q24h') && inText(techBlk, '此試算同不可靠')
  && inText(techBlk, '腎功能'),
  'BLOCK → 技術完整版保留數值供覆核，但標明閘門成因與不可靠');
c('S59', SUM.appendCustomSimulation('PLAN', null, sumBlk, 'clinical') === 'PLAN'
  && SUM.appendCustomSimulation('PLAN', null, sumOpen, 'technical') === 'PLAN',
  '未執行自訂試算時原樣返回，不插入空附註');
c('S60', !inText(SUM.appendCustomSimulation('PLAN', custom, sumOpen, 'clinical'), '輸注速率過快')
  && inText(SUM.appendCustomSimulation('PLAN',
    Object.assign({ rateNote: '輸注速率過快：X' }, custom), sumOpen, 'clinical'), '輸注速率過快：X'),
  '輸注速率提示由呼叫端傳入，有才顯示');

// ─────────── 14. verdict 缺漏時 fail-closed（CR-2）───────────
console.log('\n--- 安全邊界預設值 ---');
const noVerdict = SUM.buildClinicalSummary(mkResult({ auc24: 320 }), undefined, 2);
c('S61', noVerdict.blocked && !noVerdict.canCalculate
  && noVerdict.recommendation.regimen === null
  && !inText(SUM.buildClinicalPlan(noVerdict), '750'),
  '完全沒有 verdict → 視為不可計算、不出具體劑量（不得 fail-open）');
const partialVerdict = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  { status: 'BLOCK', confidence: 'Low', messages: [] }, 2);
c('S62', partialVerdict.blocked && !partialVerdict.canCalculate
  && !inText(SUM.buildClinicalPlan(partialVerdict), '750'),
  'verdict 缺 allowCalculation／allowDoseRecommendation 欄位 → 同樣 fail-closed');
const realVerdict = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 320 });
c('S63', typeof realVerdict.allowCalculation === 'boolean'
  && typeof realVerdict.allowDoseRecommendation === 'boolean'
  && !SUM.buildClinicalSummary(mkResult({ auc24: 320 }), realVerdict, 2).blocked,
  'safety.js 一律產出兩個布林，fail-closed 不誤傷正常路徑');

// ─────────── 15. classifyLocal 僅限 Mode 1（CR-3）───────────
// safety 未提供 AUC 分級時，Mode 2/3 不得自行以常數重算一份判讀——
// 否則畫面會顯示「高於目標」而閘門仍開，判讀與行為分歧。
const sfNoAuc = S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 } });
const m2NoAuc = SUM.buildClinicalSummary(mkResult({ auc24: 684 }), sfNoAuc, 2);
c('S64', m2NoAuc.status.key === 'insufficient',
  'Mode 2 且 safety 未給 AUC 分級 → 判讀為「資料不足」，不以常數重算');
const sfM1 = S.buildSafetyMessages({ mode: 1, eligibility: { age: 65 }, dataQuality: { input: {}, mode: 1 } });
c('S65', SUM.buildClinicalSummary(mkResult({ auc24: 684 }), sfM1, 1).status.key === 'high'
  && SUM.buildClinicalSummary(mkResult({ auc24: 498 }), sfM1, 1).status.key === 'ok'
  && !SUM.buildClinicalSummary(mkResult({ auc24: 498 }), sfM1, 1).blocked,
  'Mode 1 保留常數退回判讀（經驗起始不送 classifyAUC），且不影響閘門');

// ─────────── 16. 無法計算時的摘要（CR-5）───────────
console.log('\n--- 計算失敗摘要 ---');
const fatal = SUM.buildFatalSummary(['ke 為非有限值', '兩點濃度未遞減'], null, 2);
const fatalPlan = SUM.buildClinicalPlan(fatal);
c('S66', fatal.blocked && fatal.current === null && fatal.status.key === 'insufficient'
  && fatal.recommendation.regimen === null,
  '計算失敗摘要：無現況區、無建議、狀態為資料不足');
c('S67', fatal.blockedReasons.length === 2 && fatal.monitoring.length > 0,
  '計算失敗摘要必含原因與明確下一步（§八.8）');
c('S68', inText(fatalPlan, 'ke 為非有限值') && !inText(fatalPlan, '評估：'),
  '計算失敗時 Plan 仍可組出（跳過評估段，不吐 undefined）');
c('S69', SUM.buildFatalSummary([], [], 3).blockedReasons.length === 1
  && SUM.buildFatalSummary([], [], 3).monitoring.length === 1,
  '未給原因／下一步時退回通用文字，不留空白區塊');

// ─────────── 17. 顯示用分級（供 what-if badge；非閘門）───────────
console.log('\n--- 顯示用分級 ---');
c('S70', SUM.classifyDisplay(VANCO.AUC_TARGET_MIN) === 'ok'
  && SUM.classifyDisplay(VANCO.AUC_TARGET_MAX) === 'ok'
  && SUM.classifyDisplay(VANCO.AUC_TARGET_MIN - 1) === 'low'
  && SUM.classifyDisplay(VANCO.AUC_AKI_THRESHOLD + 1) === 'high'
  && SUM.classifyDisplay(NaN) === 'insufficient',
  '顯示用分級的邊界與 safety 的 classifyAUC 同語意（400／600 皆屬達標）');
c('S71', SUM.displayTag(500) === '達標' && SUM.displayTag(320) === '偏低'
  && SUM.displayTag(684) === '偏高' && SUM.displayTag(NaN) === '無法判讀',
  'what-if badge 字樣由同一份分級產生，UI 不另寫一套');

// ─────────── 18. 第二層：外推參考／替代方案的可複製摘要 ───────────
console.log('\n--- 外推參考可複製摘要 ---');
const extOpenSum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65 }, auc: 320 }), 2);
const extBlkSum = SUM.buildClinicalSummary(mkResult({ auc24: 320 }),
  S.buildSafetyMessages({ mode: 2, eligibility: { age: 65, declaredAKI: true }, auc: 320 }), 2);
const extCustom = { dose: 1250, tau: 12, tInf: 2, dailyMg: 2500, auc24: 610, peak: 38.4, trough: 15.9 };
const extOpen = SUM.buildExtrapolationSummary(extOpenSum, null);
const extBlk = SUM.buildExtrapolationSummary(extBlkSum, extCustom);

c('S72', inText(extBlk, '外推參考（非劑量建議，不可直接採用）')
  && inText(extOpen, '替代方案參考（主要建議見臨床摘要）'),
  '標題隨閘門狀態改變，BLOCK 版首行即宣告非劑量建議');
// 這是本功能最關鍵的一條：外推列不得長得像可以直接貼進醫囑的東西。
const bulletLines = extBlk.split('\n').filter((l) => l.indexOf('- ') === 0);
c('S73', bulletLines.length > 0 && bulletLines.every((l) => !inText(l, 'Vancomycin') && !inText(l, ' IV ')),
  'BLOCK 時所有外推列一律用畫面格式（750 mg q12h），不得出現病歷格式醫囑');
c('S74', inText(extBlk, '750 mg q12h') && inText(extBlk, '1250 mg q12h')
  && inText(extBlk, 'AUC24 610'),
  '外推方案與自訂試算的劑量、預估暴露量照常提供（這正是本段的用途）');
c('S75', inText(extBlk, '本案安全閘門已擋下劑量建議，成因：')
  && extBlkSum.blockedReasons.every((r) => inText(extBlk, r))
  && inText(extBlk, '不得作為醫囑'),
  'BLOCK 版列出全部閘門成因並明示不得作為醫囑');
c('S76', inText(extBlk, 'Vancomycin 1000 mg IV q12h'),
  '現況那行仍用病歷格式（病人已在用的方案，非新產生的外推值）');
c('S77', !inText(extOpen, '安全閘門') && inText(extOpen, '非主要建議'),
  '閘門開啟時不談閘門，但仍標明此段非主要建議');
c('S78', inText(extBlk, '下一步：') && extBlkSum.monitoring.every((m) => inText(extBlk, m)),
  '外推摘要含與臨床摘要一致的下一步（同一份 monitoring，未另寫）');
c('S79', SUM.buildExtrapolationSummary(extBlkSum, null) !== ''
  && SUM.buildExtrapolationSummary(
    SUM.buildClinicalSummary(mkResult({ alternatives: [] }), sfM1Plain, 1), null) === '',
  '無替代方案且無自訂試算時回空字串（按鈕據此隱藏）');
c('S80', !inText(SUM.buildClinicalPlan(extBlkSum), '1250')
  && !inText(SUM.buildClinicalPlan(extBlkSum), '外推方案'),
  '新增此段不影響臨床簡版：預設複製內容仍不含任何外推劑量');

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
