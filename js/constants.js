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

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { VANCO, CG };
} else {
  // 瀏覽器：classic script 的 top-level const 不會掛上 window，手動附掛供 pk.js 讀取
  const g = (typeof self !== 'undefined') ? self : this;
  g.VANCO = VANCO;
  g.CG = CG;
}
