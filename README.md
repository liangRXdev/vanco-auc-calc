# Vancomycin AUC Calculator（萬古黴素 AUC 導向劑量計算器）

繁體中文、純前端、可離線、GitHub Pages 部署的萬古黴素 AUC 導向劑量工具。
臨床數據集中於 `js/constants.js`，不寫死於邏輯。

🔗 **線上使用**：https://liangrxdev.github.io/vanco-auc-calc/
> ⚕️ 僅供臨床決策輔助，不取代專業判斷。所有劑量須經藥師/醫師覆核。

## 定位

| | 本工具 | clincalc / vancocalc / vancopk |
|---|---|---|
| 語言 | **繁體中文**（市面唯一） | 英文 |
| 方法 | 透明公開（顯示公式與模型參數）| 多為 Bayesian  |
| Bayesian | Goti 2018 二室 MAP，先驗參數公開 |  |
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
- 優勢：**單一濃度、非穩態、早至首劑後**即可估 AUC
- 輸出：個體 PK（先驗→個體 η）、擬合檢核、達目標劑量建議（穩態峰/谷）
- 安全閘門（v0.3.0）：多起點收斂檢查、NaN 守衛、非穩態取樣標「穩態投影」、AUC>600 改結構化處置（不逕給單行減量）
- 資料信心分層（v0.3.2，**由 L2 shrinkage 背書**）：穩態雙點→High、穩態單點→Moderate、非穩態→Low，結果頁以 badge 呈現
- 臨床聲明勾選（v0.3.2）：AKI / 給藥或採血時間不可靠 / 懷孕 / CF（無法自動偵測，勾選後降信心；AKI 停出劑量建議）

> ⚠️ **血液透析（HD）為 experimental / research-use**：Goti 模型僅含二元透析共變數（CL×0.7、Vc×0.5），**未建模**透析清除率、intradialytic dosing 與 post-HD 再分布。HD 之 Bayesian 輸出**僅供 AUC 估計參考、不產生具體劑量建議**，須臨床人員自行判斷。

**適用族群**：成人（≥18 歲）正常腎功能、肥胖（BMI≥30）、腎功能不全。
**受限 / 不涵蓋**：間歇性 HD（research-use，見上）；CRRT / SLED / ECMO / 兒童 / 孕婦（未建模或先驗不適用，見工具內警示）。

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
│   ├── bayes.js            # 二室 Bayesian MAP 引擎（Mode 3；含收斂/多起點/NaN 守衛）
│   ├── bayes.test.js       # sanity test（31/31）
│   ├── bayes.validation.js # L1 解析解 oracle + L2 模擬-估計（可重跑）
│   ├── bayes.golden.test.js# golden-master 回歸基準（21/21）
│   ├── safety.js           # 確定性安全層（eligibility / 濃度守衛 / 擬合守衛 / AUC 分級）
│   ├── safety.test.js      # 安全行為 C-cases（33/33）
│   └── ui.js               # DOM 綁定與渲染
└── css/style.css           # Noto Sans TC + DM Mono、BEM
```

技術：純 HTML/CSS/JS 無框架（同 bicarb-dosing-calc）。

## 測試

```bash
node js/pk.test.js           # Mode 1/2（一室、Sawchuk-Zaske）              17/17
node js/bayes.test.js        # Mode 3（收斂旗標、NaN 守衛、穩態 AUC）        31/31
node js/safety.test.js       # 安全層行為（BLOCK/WARNING 觸發正確性）        33/33
node js/bayes.golden.test.js # golden-master 回歸基準                        21/21
node js/bayes.validation.js  # L1 解析解 oracle（硬 gate）+ L2 模擬-估計（N=1000）
```

> ⚠️ `*.test.js` 多為 **verification（自洽一致性）**。真正的 Mode 3 **validation** 走 `bayes.validation.js`：L1 以**獨立解析解**交叉驗證 RK4（打破 round-trip 循環性），L2 以模擬-估計量測 bias/precision/shrinkage。詳見 `docs/bayes-validation.md`。

## Validation status

| 範圍 | 狀態 |
|---|---|
| Mode 1/2 數值 | 有限數學驗證 + 對 ClinCalc 選定案例交叉核對（見 `docs/validation.md`）|
| Mode 3 引擎 | **L1 獨立解析解 oracle：PASS**（RK4 vs 封閉解 <1e-6）；**L2 模擬-估計：完成**（N=1000，若 Goti 為真估計器無偏）。見 `docs/bayes-validation.md` |
| 外部 Bayesian 對照 | 商用工具 / 富取樣 AUC：**未執行** |
| 前瞻臨床驗證 | **未執行** |

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
