/**
 * pk.js — 萬古黴素藥動學核心計算（純函式，可獨立測試）
 *
 * 方法：一室模型、零階輸注 + 一階消除；雙點法採 Sawchuk-Zaske。
 * AUC 採完整兩段式（輸注期梯形 + 消除期對數梯形），非僅消除期簡化式。
 * 對應 wiki: concept-Vancomycin-AUC-TDM（方法 B）、source-rybak2020。
 *
 * 依賴 constants.js 的 VANCO / CG。
 */
(function (root) {
  const C = (typeof require !== 'undefined') ? require('./constants.js') : root;
  const VANCO = C.VANCO;
  const CG = C.CG;
  const CRASS = C.CRASS;

  // ---------- 體重 ----------
  /** Devine 理想體重 (kg)。sexMale: boolean；heightCm: number */
  function idealBodyWeight(sexMale, heightCm) {
    const inchesOver5ft = (heightCm / 2.54) - 60;
    const base = sexMale ? 50 : 45.5;
    return base + 2.3 * inchesOver5ft; // 身高 <5ft 時會 <base，屬公式外推，交由呼叫端判斷
  }

  /** 校正體重 AdjBW = IBW + 0.4×(TBW − IBW) */
  function adjustedBodyWeight(tbw, ibw) {
    return ibw + CG.ADJ_FACTOR * (tbw - ibw);
  }

  /**
   * Cockcroft-Gault CrCl 用的體重選用：
   *   TBW < IBW           → 用 TBW（消瘦）
   *   TBW > 1.2×IBW       → 用 AdjBW（肥胖）
   *   其間                → 用 TBW
   * 回傳 { weight, label }
   */
  function crclDosingWeight(tbw, ibw) {
    if (tbw < ibw) return { weight: tbw, label: 'TBW（消瘦，TBW<IBW）' };
    if (tbw > CG.OBESE_TBW_OVER_IBW * ibw) {
      return { weight: adjustedBodyWeight(tbw, ibw), label: 'AdjBW（肥胖）' };
    }
    return { weight: tbw, label: 'TBW' };
  }

  /** Cockcroft-Gault CrCl (mL/min)。weightKg 應為 crclDosingWeight 選出的體重 */
  function cockcroftGault(age, weightKg, scr, sexMale) {
    const crcl = ((140 - age) * weightKg) / (72 * scr);
    return sexMale ? crcl : crcl * 0.85;
  }

  // ---------- 劑量圓整 ----------
  /** 圓整到最近 250 mg（臨床實務常用增量）*/
  function roundDose(mg, step = 250) {
    return Math.round(mg / step) * step;
  }

  // ---------- Mode 1：經驗起始劑量 ----------
  /**
   * 依 actual body weight 給負荷 + 維持起始建議（尚無血中濃度）。
   * 維持用族群 CL 反推 AUC（取代 mg/kg，避免衝破 AUC）。
   * CL 模型可選：'matzke'（預設，一般族群）或 'crass'（肥胖 pop-PK，Crass 2018）。
   * input: { tbw, sexMale, heightCm, age, scr, criticallyIll, targetAuc?, clModel? }
   */
  function empiricDosing(input) {
    const { tbw, sexMale, heightCm, age, scr, criticallyIll } = input;
    const targetAuc = input.targetAuc || VANCO.AUC_TARGET_DEFAULT;
    const clModel = input.clModel === 'crass' ? 'crass' : 'matzke';
    const ibw = idealBodyWeight(sexMale, heightCm);
    const cw = crclDosingWeight(tbw, ibw);
    const crcl = cockcroftGault(age, cw.weight, scr, sexMale);
    const bmi = tbw / Math.pow(heightCm / 100, 2);

    let clPop, vdPop, loading, loadingCapped, interval, nomogram = null;
    if (clModel === 'crass') {
      // 肥胖 CL 模型（一室）：CLV(age/SCr/sex/TBW^0.75)；Vd 依 BMI 分段；負荷/間隔採 nomogram
      clPop = crassClVanco(age, scr, sexMale, tbw);
      vdPop = crassVd(tbw, bmi);
      loading = crassLoading(clPop);
      loadingCapped = false;               // Crass 負荷為固定 nomogram 值（非 mg/kg 封頂）
      interval = suggestIntervalByClv(clPop);
      nomogram = crassNomogramRow(clPop);  // 對照 Table 2
    } else {
      // Matzke：族群 CL 反推 AUC；負荷 mg/kg TBW cap 3000
      clPop = matzkeClVanco(crcl);
      vdPop = VANCO.VD_LKG_DEFAULT * tbw;
      const loadingRaw = ((VANCO.LOADING_MGKG_MIN + VANCO.LOADING_MGKG_MAX) / 2) * tbw;
      loading = Math.min(roundDose(loadingRaw), VANCO.LOADING_CAP_MG);
      loadingCapped = loadingRaw > VANCO.LOADING_CAP_MG;
      interval = suggestIntervalByCrCl(crcl);
    }

    // 維持：TDD = 目標 AUC × CL → 依間隔分配
    const tddTarget = targetAuc * clPop;            // mg/day
    const maintPerDose = roundDose(tddTarget * (interval / 24));
    const maintDaily = maintPerDose * (24 / interval);
    const predictedAuc24 = maintDaily / clPop;

    // 以族群 PK 預測該方案穩態峰/谷（假設 1h 輸注）
    const kePop = clPop / vdPop;
    const pt = steadyStatePeakTrough(maintPerDose, interval, VANCO.EMPIRIC_TINF_H, kePop, vdPop);

    return {
      clModel, bmi,
      ibw, crclWeight: cw, crcl,
      loadingDose: loading,
      loadingCapped,
      clPop, vdPop, targetAuc, tddTarget,
      maintenanceDose: maintPerDose,
      maintenanceInterval: interval,
      maintenanceDailyMg: maintDaily,
      predictedAuc24,
      predictedPeak: pt.peak,
      predictedTrough: pt.trough,
      nomogram,
      warnings: empiricWarnings({ crcl, criticallyIll, maintDaily, predictedAuc24, predictedTrough: pt.trough, tbw, ibw, clModel, bmi, clPop }),
    };
  }

  /** 族群 CLvanco（Matzke 1984）：CLvanco(mL/min)=0.69×CrCl+3.66 → 回傳 L/h */
  function matzkeClVanco(crcl) {
    const mlmin = VANCO.MATZKE_SLOPE * crcl + VANCO.MATZKE_INTERCEPT;
    return mlmin * 60 / 1000; // mL/min → L/h
  }

  /** Crass 2018 肥胖 CLV（一室，L/h）。age歲/scr mg-dL(IDMS)/sexMale/TBW實際體重kg。 */
  function crassClVanco(age, scr, sexMale, tbw) {
    return CRASS.INTERCEPT - CRASS.AGE * age - CRASS.SCR * scr
      + CRASS.SEX * (sexMale ? 1 : 0) + CRASS.TBW_COEF * Math.pow(tbw, CRASS.TBW_EXP);
  }

  /** Crass 肥胖 Vd (L)：0.8 L/kg TBW；BMI 40–49.9→0.52、≥50→0.42。 */
  function crassVd(tbw, bmi) {
    const perKg = bmi >= 50 ? CRASS.VD_BMI50 : bmi >= 40 ? CRASS.VD_BMI40 : CRASS.VD_LKG;
    return perKg * tbw;
  }

  /** Crass nomogram 負荷：CLV≥8→3000、否則 2500 (mg)。 */
  function crassLoading(clv) {
    return clv >= CRASS.LOAD_HIGH_CLV ? CRASS.LOAD_HIGH : CRASS.LOAD_LOW;
  }

  /** 取最接近估計 CLV 的 nomogram bin（Table 2）供對照；CLV<0.5 回 null。 */
  function crassNomogramRow(clv) {
    if (clv < CRASS.CLV_MIN_REC) return null;
    const bin = Math.max(1, Math.min(10, Math.round(clv)));
    return CRASS.NOMOGRAM.find((r) => r.clv === bin) || null;
  }

  /** 依 CrCl 粗略建議間隔（Matzke 路徑；仍需 TDM 校正）*/
  function suggestIntervalByCrCl(crcl) {
    if (crcl >= 90) return 8;
    if (crcl >= 50) return 12;
    if (crcl >= 20) return 24;
    return 48; // <20：延長，密切監測
  }

  /** Crass nomogram 間隔：CLV<4→q24、≥4→q12。 */
  function suggestIntervalByClv(clv) {
    return clv < CRASS.TAU_SWITCH_CLV ? 24 : 12;
  }

  // ---------- 穩態峰/谷 與 方案試算（共用）----------
  /** 給定 PK 參數，回傳某方案的穩態峰（輸注末）與谷（間隔末）*/
  function steadyStatePeakTrough(dose, tau, tInf, ke, vd) {
    const peak = (dose / tInf) * (1 - Math.exp(-ke * tInf)) /
                 (vd * ke * (1 - Math.exp(-ke * tau)));
    const trough = peak * Math.exp(-ke * (tau - tInf));
    return { peak, trough };
  }

  /**
   * 以個人化 PK 試算任一 dose / interval 的預期峰/谷/AUC24。
   * 供結果頁「自訂方案試算」與間隔比較表共用。
   */
  function simulateRegimen(dose, tau, tInf, ke, vd, cl, mic) {
    const { peak, trough } = steadyStatePeakTrough(dose, tau, tInf, ke, vd);
    const dailyMg = dose * (24 / tau);
    const auc24 = dailyMg / cl; // AUC 由每日總量決定
    return {
      peak, trough, dailyMg, auc24,
      aucOverMic: auc24 / (mic || VANCO.MIC_DEFAULT),
      impractical: dose > VANCO.MAINT_PERDOSE_PRACTICAL_MAX,
      inTarget: auc24 >= VANCO.AUC_TARGET_MIN && auc24 <= VANCO.AUC_TARGET_MAX,
    };
  }

  // ---------- Mode 2：雙點法反算 AUC + 調整 ----------
  /**
   * Sawchuk-Zaske 雙點法。levels 為間隔內任意兩個消除期時刻。
   * input: {
   *   dose,      // 本間隔給藥量 mg
   *   tau,       // 給藥間隔 h
   *   tInf,      // 輸注時長 h
   *   c1, t1,    // 濃度1 (mg/L)、採血時刻（距本次輸注開始 h）
   *   c2, t2,    // 濃度2、時刻（t2 > t1，兩者皆 ≥ tInf）
   *   mic,       // 預設 VANCO.MIC_DEFAULT
   * }
   * 回傳 PK 參數 + AUC24 + AUC/MIC + 預測峰谷 + 各間隔劑量建議。
   */
  function twoLevelAUC(input) {
    const { dose, tau, tInf, c1, t1, c2, t2 } = input;
    const mic = input.mic || VANCO.MIC_DEFAULT;
    const errors = validateTwoLevel(input);
    if (errors.length) return { ok: false, errors };

    // 1) 消除速率常數（兩點皆在消除期）
    const ke = Math.log(c1 / c2) / (t2 - t1);
    const halfLife = 0.693 / ke;

    // 2) 外推真峰（輸注結束 t=tInf）與真谷（間隔末 t=tau）
    const cMaxTrue = c1 * Math.exp(ke * (t1 - tInf)); // 由 c1 回推至輸注結束
    const cMinTrue = c2 * Math.exp(-ke * (tau - t2)); // 由 c2 前推至間隔末

    // 3) 分布容積 Vd（Sawchuk-Zaske 輸注式；穩態下前後 trough 相等取 cMinTrue）
    const vd = (dose / tInf) * (1 - Math.exp(-ke * tInf)) /
               (ke * (cMaxTrue - cMinTrue * Math.exp(-ke * tInf)));
    const cl = ke * vd; // L/h

    // 4) AUC 兩段式：輸注期梯形 + 消除期對數梯形
    const aucInfusion = ((cMaxTrue + cMinTrue) / 2) * tInf;
    const aucElim = (cMaxTrue - cMinTrue) / ke;
    const aucTau = aucInfusion + aucElim;
    const auc24 = aucTau * (24 / tau);
    const aucOverMic = auc24 / mic;

    // 交叉驗證：AUC24 亦應 ≈ 每日總量 / CL
    const tddCurrent = dose * (24 / tau);
    const auc24Check = tddCurrent / cl;

    // 5) 比例線性外推：達 AUC 目標中點（500）所需每日總劑量
    const targetMid = (VANCO.AUC_TARGET_MIN + VANCO.AUC_TARGET_MAX) / 2;
    const tddTarget = tddCurrent * (targetMid / auc24);
    const intervalOptions = VANCO.INTERVALS_H.map((h) => {
      const perDose = roundDose(tddTarget * (h / 24));
      // 各間隔的穩態峰/谷（隨間隔而異，為選擇間隔的臨床依據；AUC 則與間隔無關）
      const sim = simulateRegimen(perDose, h, tInf, ke, vd, cl, mic);
      return {
        intervalH: h,
        doseMg: perDose,
        dailyMg: sim.dailyMg,
        projectedAuc24: sim.auc24,
        projectedPeak: sim.peak,
        projectedTrough: sim.trough,
        impractical: sim.impractical,
      };
    });

    return {
      ok: true,
      ke, halfLife, vd, cl,
      tInf, // 供結果頁自訂試算沿用
      cMaxTrue, cMinTrue,
      auc24, aucOverMic, aucTau, aucInfusion, aucElim,
      auc24Check,
      tddCurrent, tddTarget,
      intervalOptions,
      mic,
      warnings: twoLevelWarnings({ auc24, cMinTrue, mic }),
    };
  }

  // ---------- 驗證 ----------
  function validateTwoLevel(input) {
    const e = [];
    const { c1, t1, c2, t2, tInf, tau, dose } = input;
    if (!(dose > 0)) e.push('給藥量須 > 0');
    if (!(tau > 0)) e.push('給藥間隔須 > 0');
    if (!(tInf > 0)) e.push('輸注時長須 > 0');
    if (!(c1 > 0 && c2 > 0)) e.push('濃度須 > 0');
    if (!(t2 > t1)) e.push('第二採血時刻須晚於第一採血時刻');
    if (t1 < tInf) e.push('第一採血須在輸注結束後（t1 ≥ 輸注時長），否則仍在分布/輸注期，公式不適用');
    if (t2 > tau) e.push('採血時刻不可超過給藥間隔');
    // 消除期濃度須遞減：c2 ≥ c1 會使 ke ≤ 0（負半衰期/AUC 亂數），必須擋下
    if (c1 > 0 && c2 > 0 && c2 >= c1) e.push('第二點濃度須低於第一點（消除期濃度應遞減；請確認未把峰/谷填反或在分布期採血）');
    return e;
  }

  // ---------- 警示 ----------
  function empiricWarnings({ crcl, criticallyIll, maintDaily, predictedAuc24, predictedTrough, tbw, ibw, clModel, bmi, clPop }) {
    const w = [];
    const obese = tbw > CG.OBESE_TBW_OVER_IBW * ibw;
    const crass = clModel === 'crass';
    if (crcl < 30) w.push({ level: 'warn', msg: `CrCl ${crcl.toFixed(0)} mL/min 偏低${crass ? '（Crass 建模排除 CLcr<30，肥胖 CL 模型外推性差，建議改 Matzke + 密集 TDM）' : '，間隔已延長'}；腎功能不穩者須每次調整後重採血。` });
    if (crass) {
      if (bmi < CRASS.BMI_OBESE)
        w.push({ level: 'warn', msg: `BMI ${bmi.toFixed(1)} < 30：Crass 模型建立於肥胖族群，非肥胖者請改用 Matzke。` });
      if (clPop < CRASS.CLV_MIN_REC)
        w.push({ level: 'warn', msg: `估計 CLV ${clPop.toFixed(2)} < 0.5 L/h：超出 Crass 建模族群，無 nomogram 建議，須臨床判斷 + 密集 TDM。` });
      w.push({ level: 'info', msg: `肥胖 CL 模型：Crass 2018（CLV=age/SCr/sex/TBW^0.75，SCr 須 IDMS）；維持 TDD=目標AUC×CLV、負荷採 nomogram（less is more）。` });
    } else if (obese) {
      w.push({ level: 'warn', msg: `肥胖患者：Matzke 族群 CL 可能偏差（一般族群回歸）；建議切換「Crass 肥胖 CL 模型」，或儘早雙點 TDM。` });
    }
    if (obese && maintDaily > VANCO.MAINT_MONITOR_MGDAY)
      w.push({ level: 'warn', msg: `維持 ${maintDaily.toFixed(0)} mg/day > ${VANCO.MAINT_MONITOR_MGDAY}：需早期強化 AUC 監測（Rybak Rec 13）。` });
    if (predictedTrough > VANCO.TROUGH_AKI_REF)
      w.push({ level: 'info', msg: `預測 trough ${predictedTrough.toFixed(1)} > ${VANCO.TROUGH_AKI_REF} mg/L（傳統 AKI 參考；以 AUC 為準）。` });
    w.push({ level: 'info', msg: `維持劑量以族群 CL 反推目標 AUC（非 mg/kg）；預測 AUC24 ≈ ${predictedAuc24.toFixed(0)}。此為經驗估計，24–48h 內採雙點驗證。` });
    return w;
  }

  function twoLevelWarnings({ auc24, cMinTrue, mic }) {
    const w = [];
    if (auc24 > VANCO.AUC_AKI_THRESHOLD)
      w.push({ level: 'warn', msg: `AUC24 ${auc24.toFixed(0)} > ${VANCO.AUC_AKI_THRESHOLD}：AKI 風險上升，建議減量。` });
    if (auc24 < VANCO.AUC_TARGET_MIN)
      w.push({ level: 'warn', msg: `AUC24 ${auc24.toFixed(0)} < ${VANCO.AUC_TARGET_MIN}：暴露不足，建議加量。` });
    if (mic >= VANCO.MIC_ALT_AGENT)
      w.push({ level: 'warn', msg: `MIC ≥ ${VANCO.MIC_ALT_AGENT} mg/L：傳統劑量難達 AUC/MIC ≥400，考慮換藥（Rybak Rec 5）。` });
    if (cMinTrue > VANCO.TROUGH_AKI_REF)
      w.push({ level: 'info', msg: `預測 trough ${cMinTrue.toFixed(1)} > ${VANCO.TROUGH_AKI_REF} mg/L（傳統 AKI 風險參考；以 AUC 為準）。` });
    return w;
  }

  const api = {
    idealBodyWeight, adjustedBodyWeight, crclDosingWeight, cockcroftGault,
    roundDose, suggestIntervalByCrCl, suggestIntervalByClv, matzkeClVanco,
    crassClVanco, crassVd, crassLoading, crassNomogramRow,
    empiricDosing, twoLevelAUC, validateTwoLevel,
    steadyStatePeakTrough, simulateRegimen,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PK = api;
})(typeof self !== 'undefined' ? self : this);
