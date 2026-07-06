# Vancomycin AUC Calculator（萬古黴素 AUC 導向劑量計算器）

繁體中文、純前端、可離線、GitHub Pages 部署的萬古黴素 AUC 導向劑量工具。
臨床數據集中於 `js/constants.js`（對應 Obsidian wiki 證據頁），不寫死於邏輯。

🔗 **線上使用**：https://liangrxdev.github.io/vanco-auc-calc/
> ⚕️ 僅供臨床決策輔助，不取代專業判斷。所有劑量須經藥師/醫師覆核。

## 定位（與競品差異）

| | 本工具 | clincalc / vancocalc / vancopk |
|---|---|---|
| 語言 | **繁體中文**（市面唯一） | 英文 |
| 方法 | 透明公開（顯示公式與模型參數）| 多為 Bayesian 黑箱 |
| Bayesian | Goti 2018 二室 MAP，先驗參數公開 | 多需訂閱、模型不透明 |
| 部署 | 純前端、可離線、免伺服器 | 多需線上 |
| 實證 | 每項建議連結證據來源 | — |

GitHub 調研（2026-07-03）：無主流開源純前端 Vanco AUC 計算器，無任何繁中版 → 藍海，原生開發。

## 功能（v0.2.0）

**Mode 1｜經驗起始劑量**（尚無血中濃度）
- Cockcroft-Gault CrCl → 負荷 20–25 mg/kg TBW（cap 3000）
- 維持：**族群 CL（Matzke）反推目標 AUC**（滑桿 400–600，預設 500），非 mg/kg
- ⚠ 為何不用 mg/kg：15–20 mg/kg q8–12h 是 trough 時代法，會系統性衝破 AUC 400–600（實測對應 AUC 770–1500）。改用 `TDD = 目標AUC × 族群CL`，與 Mode 2/ClinCalc 同邏輯。經 ClinCalc 交叉驗證（見 `docs/validation.md`）

**Mode 2｜雙點反算 AUC + 調整**（已有兩點濃度）
- 間隔內任兩時刻濃度 → Sawchuk-Zaske 算 ke/Vd/CL → **完整兩段式 AUC**（輸注梯形 + 消除對數梯形）
- 對照目標 400–600 → 比例線性外推各間隔劑量建議

**Mode 3｜Bayesian AUC**（1–2 點，可非穩態）
- **Goti 2018 二室族群 PK 模型**為先驗；RK4 模擬給藥史，MAP（Sheiner-Beal 目標函數）+ Nelder-Mead 最佳化求個體 CL/Vc/Vp
- 優勢：**單一濃度、非穩態、早至首劑後**即可估 AUC；支援血液透析共變數（CL×0.7、Vc×0.5）
- 輸出：個體 PK（先驗→個體 η）、擬合檢核、達目標劑量建議（穩態峰/谷）

**支援族群**：正常腎功能、肥胖（BMI≥30）、腎功能不全、間歇性血液透析。

### ⚠️ 兩個關鍵設計約束

1. **體重雙用**：Vanco 劑量 mg/kg 用 **actual body weight (TBW)**；Cockcroft-Gault CrCl 用 **AdjBW**（肥胖）= IBW + 0.4×(TBW−IBW)。
2. **AUC 完整兩段式**（Mode 2）：`AUC_τ = (Cmax+Cmin)/2×t_inf + (Cmax−Cmin)/ke`，非僅消除期簡化式（後者低估 ~10%，已於 `pk.test.js` 佐證 9.5%）。

## Phase 3（未開工）

- Crass 2018 肥胖 CLV 作為 Bayesian 先驗選項
- CRRT / 持續輸注（CI）
- 給藥史「完整事件列」進階模式（目前為規則方案）

## 架構

```
vanco-auc-calc/
├── index.html          # 單頁，三 tab
├── js/
│   ├── constants.js    # 臨床常數（VANCO / CG / GOTI，集中管理）
│   ├── pk.js           # 一室藥動學純函式（Mode 1/2）
│   ├── pk.test.js      # sanity test（17/17）
│   ├── bayes.js        # 二室 Bayesian MAP 引擎（Mode 3）
│   ├── bayes.test.js   # sanity test（22/22）
│   └── ui.js           # DOM 綁定與渲染
└── css/style.css       # Noto Sans TC + DM Mono、BEM
```

技術：純 HTML/CSS/JS 無框架（同 bicarb-dosing-calc）。

## 測試

```bash
node js/pk.test.js      # Mode 1/2（一室、Sawchuk-Zaske）
node js/bayes.test.js   # Mode 3（二室 MAP：往返一致、自洽回復、穩態 AUC）
```

## 參考文獻（References）

臨床指引與模型：

- Rybak, M. J., Le, J., Lodise, T. P., Levine, D. P., Bradley, J. S., Liu, C., Mueller, B. A., Pai, M. P., Wong-Beringer, A., Rotschafer, J. C., Rodvold, K. A., Maples, H. D., & Lomaestro, B. M. (2020). Therapeutic monitoring of vancomycin for serious methicillin-resistant *Staphylococcus aureus* infections: A revised consensus guideline and review by the American Society of Health-System Pharmacists, the Infectious Diseases Society of America, the Pediatric Infectious Diseases Society, and the Society of Infectious Diseases Pharmacists. *American Journal of Health-System Pharmacy, 77*(11), 835–864. https://doi.org/10.1093/ajhp/zxaa036

- Goti, V., Chaturvedula, A., Fossler, M. J., Mok, S., & Jacob, J. T. (2018). Hospitalized patients with and without hemodialysis have markedly different vancomycin pharmacokinetics: A population pharmacokinetic model-based analysis. *Therapeutic Drug Monitoring, 40*(2), 212–221. https://doi.org/10.1097/FTD.0000000000000459

- Crass, R. L., Dunn, R., Hong, J., Krop, L. C., & Pai, M. P. (2018). Dosing vancomycin in the super obese: Less is more. *Journal of Antimicrobial Chemotherapy, 73*(11), 3081–3086. https://doi.org/10.1093/jac/dky310

- Chen, A., Gupta, A., Do, D. H., & Nazer, L. H. (2022). Bayesian method application: Integrating mathematical modeling into clinical pharmacy through vancomycin therapeutic monitoring. *Pharmacology Research & Perspectives, 10*(6), e01026. https://doi.org/10.1002/prp2.1026

- Broeker, A., Nardecchia, M., Klinker, K. P., Derendorf, H., Day, R. O., Marriott, D. J., Carland, J. E., Stocker, S. L., & Wicha, S. G. (2019). Towards precision dosing of vancomycin: A systematic evaluation of pharmacometric models for Bayesian forecasting. *Clinical Microbiology and Infection, 25*(10), 1286.e1–1286.e7. https://doi.org/10.1016/j.cmi.2019.02.029

計算方法（PK/statistics）：

- Sawchuk, R. J., & Zaske, D. E. (1976). Pharmacokinetics of dosing regimens which utilize multiple intravenous infusions: Gentamicin in burn patients. *Journal of Pharmacokinetics and Biopharmaceutics, 4*(2), 183–195. https://doi.org/10.1007/BF01086153

- Matzke, G. R., McGory, R. W., Halstenson, C. E., & Keane, W. F. (1984). Pharmacokinetics of vancomycin in patients with various degrees of renal function. *Antimicrobial Agents and Chemotherapy, 25*(4), 433–437. https://doi.org/10.1128/AAC.25.4.433

- Sheiner, L. B., Beal, S., Rosenberg, B., & Marathe, V. V. (1979). Forecasting individual pharmacokinetics. *Clinical Pharmacology & Therapeutics, 26*(3), 294–305. https://doi.org/10.1002/cpt1979263294

## 授權

MIT License（見 `LICENSE`）。臨床內容僅供教育與決策輔助用途。
