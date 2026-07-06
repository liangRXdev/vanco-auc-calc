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
  module.exports = { VANCO, CG, GOTI };
} else {
  // 瀏覽器：classic script 的 top-level const 不會掛上 window，手動附掛供 pk.js 讀取
  const g = (typeof self !== 'undefined') ? self : this;
  g.VANCO = VANCO;
  g.CG = CG;
  g.GOTI = GOTI;
}
