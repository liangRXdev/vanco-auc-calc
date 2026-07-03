# Vancomycin AUC Calculator（萬古黴素 AUC 導向劑量計算器）

繁體中文、純前端、可離線、GitHub Pages 部署的萬古黴素 AUC 導向劑量工具。
臨床數據以 Obsidian wiki 為準（Rybak 2020 共識），不寫死於程式碼。

> ⚕️ 僅供臨床決策輔助，不取代專業判斷。所有劑量須經藥師/醫師覆核。

## 定位（與競品差異）

| | 本工具 | clincalc / vancocalc / vancopk |
|---|---|---|
| 語言 | **繁體中文**（市面唯一） | 英文 |
| 方法 | 透明 **Sawchuk-Zaske 雙點一階**（顯示公式）| 多主打 Bayesian 黑箱 |
| 部署 | 純前端、可離線、免伺服器 | 多需線上 |
| 實證 | 每項建議連結 wiki 來源頁 | — |

GitHub 調研（2026-07-03）：無主流開源純前端 Vanco AUC 計算器，無任何繁中版 → 藍海，原生開發。

## MVP 範圍

**Mode 1｜經驗起始劑量**（尚無血中濃度）
- Cockcroft-Gault CrCl → 負荷 20–25 mg/kg TBW（cap 3000）
- 維持：**族群 CL（Matzke）反推目標 AUC**（滑桿 400–600，預設 500），非 mg/kg
- ⚠ 為何不用 mg/kg：15–20 mg/kg q8–12h 是 trough 時代法，會系統性衝破 AUC 400–600（實測對應 AUC 770–1500）。改用 `TDD = 目標AUC × 族群CL` 與 Mode 2/ClinCalc 同邏輯。經 ClinCalc 交叉驗證（見 `docs/validation.md`）

**Mode 2｜雙點反算 AUC + 調整**（已有濃度）
- 間隔內任兩時刻濃度 → Sawchuk-Zaske 算 ke/Vd/CL → **完整兩段式 AUC**（輸注梯形 + 消除對數梯形）
- 對照目標 400–600 → 比例線性外推各間隔劑量建議

**支援族群**：正常腎功能、肥胖（BMI≥30）、腎功能不全。

### ⚠️ 兩個關鍵設計約束

1. **體重雙用**：Vanco 劑量 mg/kg 用 **actual body weight (TBW)**；Cockcroft-Gault CrCl 用 **AdjBW**（肥胖）= IBW + 0.4×(TBW−IBW)。來源：Rybak 2020 Rec 9/12/13、Crass 2018。
2. **AUC 完整兩段式**：`AUC_τ = (Cmax+Cmin)/2×t_inf + (Cmax−Cmin)/ke`，非僅消除期簡化式（後者低估 ~10%，已在 pk.test.js 佐證 9.5%）。

## Phase 2（暫不做）

- Crass 2018 肥胖 CLV 法（`TDD = AUC目標 × CLV`，less is more）
- Trough-only 單點估計（pop Vd）
- 血液透析 / CRRT / 持續輸注
- Bayesian MAP

## 架構

```
vanco-auc-calc/
├── index.html          # 單頁，兩 tab（待建）
├── js/
│   ├── constants.js    # 臨床常數（對應 wiki，集中管理）✅
│   ├── pk.js           # 核心藥動學純函式（可測試）✅
│   └── pk.test.js      # sanity test（node js/pk.test.js，10/10 pass）✅
│   └── ui.js           # DOM 綁定（待建）
└── css/style.css       # Noto Sans TC + DM Mono、BEM（待建）
```

技術：純 HTML/CSS/JS 無框架（同 bicarb-dosing-calc）。

## 測試

```bash
node js/pk.test.js
```

## 證據來源（Obsidian wiki）

- `source-rybak2020-vancomycin-AUC-consensus`（含 exec summary piaa057、RRT/小兒）
- `source-crass2018-vancomycin-super-obese`（肥胖 pop-PK，Phase 2）
- `concept-Vancomycin-AUC-TDM`（操作快查、雙點法公式、體重雙用）
