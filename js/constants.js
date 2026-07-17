/**
 * constants.js — 萬古黴素 AUC 計算器的臨床常數（集中管理，對應 Obsidian wiki）
 *
 * 所有數值皆有來源；更新臨床建議時只改這裡，不散落於計算/UI。
 * 主要來源：
 *   - Rybak 2020 共識指引（ASHP/IDSA/PIDS/SIDP）Am J Health-Syst Pharm 2020;77:835-864
 *     wiki: source-rybak2020-vancomycin-AUC-consensus / concept-Vancomycin-AUC-TDM
 *   - Crass 2018（肥胖 pop-PK，Phase 2 用）J Antimicrob Chemother 2018;73:3081
 */

const VANCO = Object.freeze({
  // ---- PK/PD 目標 (Rybak 2020 Rec 1, A-II) ----
  AUC_TARGET_MIN: 400,        // mg·h/L
  AUC_TARGET_MAX: 600,        // mg·h/L
  AUC_AKI_THRESHOLD: 600,     // >600 AKI 風險上升（非線性）
  MIC_DEFAULT: 1,             // mg/L，除非 BMD 實測（Rec 6, B-II）
  MIC_ALT_AGENT: 2,           // MIC≥2：傳統劑量難達標，考慮換藥

  // ---- 負荷劑量 (Rybak 2020 Rec 10/12, B-II) ----
  LOADING_MGKG_MIN: 20,       // mg/kg actual body weight
  LOADING_MGKG_MAX: 25,       // mg/kg（重症可至 35，需 ≥2-3h 輸注）
  LOADING_CAP_MG: 3000,       // 上限
  LOADING_VD_BUMP: 1.25,      // 載入期 Vd 較大（vancopk 慣例 +25%）

  // ---- 維持劑量：族群 CL 反推 AUC（取代 mg/kg；mg/kg 為 trough 時代法，系統性衝破 AUC）----
  // 經驗維持 TDD = 目標 AUC × 族群 CLvanco；再依間隔分配。
  AUC_TARGET_DEFAULT: 500,       // 目標 AUC 預設（滑桿 400–600）
  // 族群 CLvanco：Matzke 1984 —— CLvanco(mL/min) = 0.69×CrCl + 3.66
  MATZKE_SLOPE: 0.69,
  MATZKE_INTERCEPT: 3.66,
  EMPIRIC_TINF_H: 1,             // 經驗峰/谷預測假設輸注時長（h）
  MAINT_OBESE_CAP_MGDAY: 4500,   // 肥胖維持日劑量上限（Rec 13；Crass：極少需 >4500）
  MAINT_MONITOR_MGDAY: 4000,     // >4000 mg/day：早期強化 AUC 監測
  MAINT_PERDOSE_PRACTICAL_MAX: 2000, // 單次維持劑量實務上限（超過標記，考慮縮短間隔）

  // ---- 輸注速率（給藥安全，非 PK）----
  // 來源不一致：FDA/部分仿單明確 ≤10 mg/min；UpToDate 建議 10–15 mg/min；
  // 另有藥廠仿單與普遍實務採「1 g / 60 min」(≈16.7 mg/min)。
  // 本工具因此把「建議」與「警示」分離：
  //   建議 = 10–15 mg/min（且 ≥60 min），以淡色提示陳述，不視為違規；
  //   警示 = >17 mg/min 才觸發——刻意高於 1g/60min 的 16.7，避免對這個
  //          普遍且多數來源接受的實務誤報，只攔明顯超出所有來源者。
  // 60 min 下限為各來源共通，仍作為警示條件（如 500mg/30min＝16.7 mg/min 雖未逾
  // 速率閾值，仍過快）。過快易誘發 vancomycin flushing reaction（舊稱 red man syndrome）。
  // 僅屬給藥安全：AUC=每日總量/CL 不受 tInf 影響，故不降信心、不擋劑量建議。
  INFUSION_RATE_ADVICE_MIN_MG_MIN: 10,
  INFUSION_RATE_ADVICE_MAX_MG_MIN: 15,
  INFUSION_RATE_WARN_MG_MIN: 17,
  MIN_INFUSION_TIME_H: 1,

  // ---- Vd / 體重 ----
  VD_LKG_DEFAULT: 0.7,        // L/kg（成人一室模型常用值；經驗峰/谷預測用 Vd=0.7×TBW）

  // ---- 監測 trough 參考（僅顯示，AUC 為主要指標）----
  TROUGH_AKI_REF: 15,         // 持續 >15 mg/L 為傳統 AKI 風險因子

  // ---- 給藥間隔選項（間隔比較表；AUC 由每日總量決定，各間隔差異在峰/谷）----
  // q48h 用於腎功能不全；正常腎需高日劑量時 q48h 單次會過大而標 ⚠
  INTERVALS_H: [8, 12, 24, 48],

  // ---- 輸入合理範圍（UI 驗證用，非硬性醫療上限）----
  RANGES: Object.freeze({
    age:   { min: 18,  max: 120, unit: '歲' },       // MVP 僅成人
    scr:   { min: 0.1, max: 15,  unit: 'mg/dL' },
    tbw:   { min: 30,  max: 300, unit: 'kg' },
    height:{ min: 120, max: 220, unit: 'cm' },
    level: { min: 0.1, max: 100, unit: 'mg/L' },
    infusion: { min: 0.5, max: 4, unit: 'h' },
    tau:   { min: 6,   max: 48,  unit: 'h' },
  }),
});

/**
 * CRASS — Crass 2018 肥胖/超級肥胖族群 CLV（一室），供 Mode 1 經驗劑量的肥胖 CL 模型選項。
 * 來源：Crass RL, et al. J Antimicrob Chemother 2018;73:3081-3086（DOI 10.1093/jac/dky310）。
 *   wiki: source-crass2018-vancomycin-super-obese
 * CLV(L/h) = 9.656 − 0.078×Age − 2.009×SCr + 1.09×Sex + 0.04×TBW^0.75
 *   Age 歲；SCr mg/dL（IDMS 標準化）；Sex 1(男)/0(女)；TBW kg（實際體重，allometric 0.75）。
 * 適用族群：BMI≥30、CLcr(Cockcroft-Gault, AdjBW)≥30；CLV<0.5 超出建模族群不建議。
 */
const CRASS = Object.freeze({
  INTERCEPT: 9.656,
  AGE: 0.078,
  SCR: 2.009,
  SEX: 1.09,          // 男 +1.09 L/h
  TBW_COEF: 0.04,
  TBW_EXP: 0.75,      // allometric

  // 分布容積：0.8 L/kg TBW；BMI 40–49.9 → 0.52；BMI ≥50 → 0.42（超肥胖 Vd/kg 下降）
  VD_LKG: 0.8,
  VD_BMI40: 0.52,
  VD_BMI50: 0.42,

  // 適用門檻
  BMI_OBESE: 30,      // 建模族群下限
  CLCR_MIN: 30,       // 建模排除 CLcr<30
  CLV_MIN_REC: 0.5,   // CLV<0.5 L/h 無建議（Table 2 footnote a）

  // 負荷（Table 2 nomogram，近乎固定，非 mg/kg）：CLV<8 → 2500、≥8 → 3000
  LOAD_LOW: 2500,
  LOAD_HIGH: 3000,
  LOAD_HIGH_CLV: 8,

  // 間隔（nomogram）：CLV<4 → q24、≥4 → q12
  TAU_SWITCH_CLV: 4,

  // Table 2 nomogram（依估計 CLV 的整數 bin；load / maint(mg) / tau(h)；供對照顯示）
  NOMOGRAM: [
    { clv: 1, load: 2500, maint: 500, tau: 24 },
    { clv: 2, load: 2500, maint: 1000, tau: 24 },
    { clv: 3, load: 2500, maint: 1500, tau: 24 },
    { clv: 4, load: 2500, maint: 1000, tau: 12 },
    { clv: 5, load: 2500, maint: 1250, tau: 12 },
    { clv: 6, load: 2500, maint: 1500, tau: 12 },
    { clv: 7, load: 2500, maint: 1750, tau: 12 },
    { clv: 8, load: 3000, maint: 2000, tau: 12 },
    { clv: 9, load: 3000, maint: 2250, tau: 12 },
    { clv: 10, load: 3000, maint: 2250, tau: 12 },
  ],
});

// Cockcroft-Gault 體重選用門檻（肥胖用 AdjBW）
const CG = Object.freeze({
  OBESE_TBW_OVER_IBW: 1.2,    // TBW > 1.2×IBW 視為肥胖 → 用 AdjBW
  ADJ_FACTOR: 0.4,            // AdjBW = IBW + 0.4×(TBW − IBW)
});

/**
 * GOTI — Goti 2018 族群 PK 模型（2-compartment），供 Phase 2 Bayesian MAP 先驗。
 * 來源：Goti V, et al. Ther Drug Monit 2018;40:212-221（Table 2，Docling 逐格核對 2026-07-06）。
 *   wiki: source-goti2018-vancomycin-popPK-HD / concept-Bayesian-MAP-estimation
 * 共變數式：
 *   TVCL = CL_POP × (CrCL/CRCL_REF)^CRCL_EXP × DIAL_CL^DIAL   (L/h)
 *   TVVc = VC_POP × (WT/WT_REF)              × DIAL_VC^DIAL    (L)
 *   Vp、Q 為固定典型值（最終模型無 WT 項、無 IIV）。
 * IIV 為指數模型變異 ω² = ln(1 + CV²)。殘差為 combined（比例+加成）。
 */
const GOTI = Object.freeze({
  CL_POP: 4.5,          // L/h（CrCL=120、非透析）
  CRCL_REF: 120,        // mL/min（冪次參考點）
  CRCL_EXP: 0.8,        // CrCL on CL 冪次
  DIAL_CL: 0.7,         // 透析時 ×CL（清除率降至 ~70%）
  VC_POP: 58.4,         // L（70 kg、非透析）
  WT_REF: 70,           // kg（體積正規化參考）
  DIAL_VC: 0.5,         // 透析時 ×Vc（中央室體積降 ~50%）
  VP: 38.4,             // L（周邊室，固定典型值）
  Q: 6.5,               // L/h（室間清除率）

  // IIV：ω² = ln(1 + CV²)。CV：CL 39.8% / Vc 81.6% / Vp 57.1%
  OMEGA2_CL: 0.147,
  OMEGA2_VC: 0.510,
  OMEGA2_VP: 0.282,

  // 殘差（combined additive + proportional）：SD(C) = √((ERR_PROP·C)² + ERR_ADD²)
  ERR_PROP: 0.227,      // 比例誤差 CV
  ERR_ADD: 3.4,         // 加成誤差 SD (mg/L)

  // CrCL 計算規則（忠於原模型）
  CRCL_CAP: 150,        // Cockcroft-Gault CrCL 上限截斷 (mL/min)
  ELDERLY_AGE: 60,      // 老年 SCr 下限校正年齡門檻
  ELDERLY_SCR_FLOOR: 1, // 若 SCr<1 且年齡>門檻 → SCr 視為 1 mg/dL
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VANCO, CG, GOTI, CRASS };
} else {
  // 瀏覽器：classic script 的 top-level const 不會掛上 window，手動附掛供 pk.js 讀取
  const g = (typeof self !== 'undefined') ? self : this;
  g.VANCO = VANCO;
  g.CG = CG;
  g.GOTI = GOTI;
  g.CRASS = CRASS;
}
