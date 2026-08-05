# 規格：結果頁改為「臨床決策優先」（v0.5.0）

> 來源：使用者 2026-08-05 的需求書（原文條號保留，供覆審逐條引用）。
> 本檔為 `/codex-review` 區塊 4「規格符合度稽核」的比對基準。

## 一、任務目標

在**不修改任何既有 PK 公式、Bayesian 模型、clinical constants、eligibility rules、safety gates
與測試基準**的前提下簡化結果頁，讓使用者能在 5–10 秒內回答：

1. 目前 AUC 是否達標？ 2. 是否可以信任這次結果？ 3. 建議調整成什麼 regimen？
4. 調整後預估 AUC／peak／trough？ 5. 下一步應何時監測？

不新增 PK 模型。

## 二、核心設計原則

- **2.1 第一屏只顯示臨床必要資訊**：目前 regimen、目前估計 AUC24、目標範圍與達標狀態、
  資料信心、建議處置、建議 regimen、調整後預估 AUC24、調整後預估 peak／trough、下一次監測建議。
- **2.2 第一屏不得顯示**：prior／posterior η、shrinkage 數值、objective function、
  convergence details、Vc／Vp／Q、完整公式、全部候選方案、大量重複警語 →
  一律移入「進階 PK 與模型資訊」折疊區。
- **2.3 結論先於數據**：摘要順序固定為 判讀 → 建議 → 預估 → 監測 → 限制。
- **2.4 一個區塊只傳達一件事**：AUC 判讀／模型信心／eligibility／safety warning／dose
  recommendation 不得混在同一段文字。

## 三、臨床摘要格式

- **3.A 狀態列**：顯示 `達標`／`低於目標`／`高於目標`／`暫不建議調整`／`資料不足`。
  **狀態不得只靠顏色辨識，必須同時有文字與 icon／badge。**
- **3.B 目前評估**：目前 regimen、估計 AUC24、判讀（含目標範圍）、資料信心。
- **3.C 建議處置**：只顯示系統**主要推薦方案**與其預估 AUC24、peak／trough；
  不在摘要一次列出所有候選方案，其他候選放折疊區或表格。
- **3.D 下一步監測**：具體可執行、**條件式**描述。
  若現有程式無法可靠推導具體採血日期或時間，**不得自行虛構日期**。
- **3.E 主要限制**：最多顯示 1–3 項最重要限制。摘要區不得重複顯示完整免責聲明
  （完整聲明留頁尾或進階區）。

## 四、依 safety gate 決定摘要內容

**保留現有 safety layer 作為唯一判斷來源，不得在 UI 另寫一套重複規則。**

- **4.1 canRecommend === true**：顯示主要推薦 regimen、預估 AUC／peak／trough、監測建議；
  可顯示其他候選方案。
- **4.2 WARNING（有 warning 無 block）**：仍可顯示估計結果；依現有 safety semantics 決定
  是否顯示劑量建議；建議旁顯示**單一**明確 caveat；不得用大量紅色警告造成結果不可讀。
- **4.3 BLOCK（safety gate 阻止推薦時）不得顯示**：具體新劑量、預設候選方案、
  看似可直接採用的 regimen、自動寫入 Plan 的新方案。
  摘要改為「目前無法安全產生具體劑量建議 + 原因清單 + 建議下一步」。
  仍可顯示 measured AUC、現行 regimen、SCr／CrCl、已知濃度，
  但**必須清楚區分「量測／估算結果」與「向未來外推的劑量建議」**。

## 五、三個模式的摘要差異

- **5.1 Mode 1（經驗起始）**：聚焦使用的 population CL 模型、loading dose、
  建議初始 maintenance regimen、預估 AUC、首次 TDM 時機、特殊族群限制。
  **不得在主要摘要展開完整 Matzke／Crass 公式。**
- **5.2 Mode 2（雙點 AUC）**：聚焦現行 regimen、measured／calculated AUC、是否達標、
  主要建議方案、預估 AUC／peak／trough、抽血時相是否可靠、下一次監測。
  完整 ke、Vd、CL、Cmax、Cmin 與 AUC 分段計算移至進階區。
- **5.3 Mode 3（Bayesian）**：聚焦 Bayesian AUC、資料信心、是否達標、主要建議方案、
  預估 AUC／peak／trough、是否存在 AKI／HD／非穩態或模型外推限制。
  prior、posterior、η、shrinkage、objective、convergence detail **全部**移至進階區。
  若 Bayesian fit 不可靠或 safety gate 阻擋，摘要不得顯示具體推薦 regimen。

## 六、可複製臨床 Plan 分兩版

- **6.1 臨床簡版**（**預設**複製內容）：目前 regimen／評估（AUC + 判讀 + 資料信心）／
  建議（regimen + 預估 AUC24、peak、trough）／監測／注意（須醫師藥師覆核）。
- **6.2 技術完整版**：方法、模型、PK parameters、confidence、safety messages、
  candidate regimens、validation／projection caveats。
  **技術完整版不得作為預設複製按鈕。**
- **6.3 按鈕名稱**：`複製臨床摘要`、`複製完整 PK 報告`。

## 七、資訊層級與版面

| 層 | 內容 | 預設 |
|---|---|---|
| 1 臨床摘要 | 見三 | **永遠展開，最醒目** |
| 2 替代方案 | 其他可行 regimen 與預估暴露量 | 折疊 |
| 3 進階 PK 與模型資訊 | CL、Vd、ke、half-life、Bayesian parameters、fit diagnostics、convergence、shrinkage、formulas、model source | 折疊 |
| 4 安全與適用性說明 | 完整 eligibility、limitations、disclaimer，集中顯示避免散落 | 折疊 |

## 八、文字與視覺要求

1. 繁體中文。
2. 臨床摘要每段最多 1–3 行。
3. **避免同一警告在 badge、alert、Plan、footer 重複四次。**
4. 數值單位必須保留。
5. **AUC 顯示為整數；peak／trough 原則上顯示一位小數。**
6. regimen 格式統一：畫面 `1000 mg q12h`；複製到病歷 `Vancomycin 1000 mg IV q12h`。
7. **「建議」與「預估」必須用不同標籤**，避免模型預測被誤認為醫囑。
8. **所有 BLOCK 狀態都必須有明確下一步**，不只顯示「無法計算」。

## 九、工程限制

1. 不修改 `constants.js` 內的臨床常數。
2. 不修改 `pk.js`、`bayes.js` 的核心計算公式。
3. **不弱化或繞過 `safety.js`。**
4. 不刪除既有測試。
5. 新的摘要轉換邏輯盡量寫成純函式：
   `buildClinicalSummary(result, safety, mode)`／`buildClinicalPlan(summary)`／
   `buildTechnicalReport(result, safety, mode)`。
6. **避免在 DOM rendering code 中散落臨床判斷條件。**
7. **確保 summary rendering 不會自行重新判讀 safety，而是消費既有 safety layer 的結果。**
8. 不引入外部框架或相依套件。
9. 維持 PWA 與離線功能。
10. 修改 app shell 後依既有規則更新 Service Worker cache version。

## 十、測試要求（驗收條件）

1. AUC 400–600：顯示達標，不建議不必要調整。
2. AUC <400：顯示低於目標與主要建議方案。
3. AUC >600：顯示高於目標及既有 safety 處置。
4. AKI／unstable renal function：依各模式既有規則處理。
5. **採血時間不可靠：不得輸出具體新劑量。**
6. HD：不得輸出主動 individualized dosing recommendation。
7. Bayesian fit failure：不得輸出具體新劑量。
8. **BLOCK 時 clinical Plan 不得含任何具體新 regimen。**
9. **WARNING 時 caveat 必須出現在摘要與 clinical Plan。**
10. 技術完整版仍包含必要 PK 與模型資訊。
11. 現有所有單元測試與 golden-master 必須通過。
12. **不得因 UI 簡化而改變任何既有計算結果。**

## 實作期間經使用者裁決的兩項偏離

- **D1（§十.5 與 §九.3 的衝突）**：規格 §十.5 要求「採血時間不可靠不得輸出具體新劑量」，
  但原 `safety.js` 的 `E_SAMPLE_TIMING` 只降信心至 Moderate、不封鎖。
  使用者裁決：**修改 `safety.js` 將其升級為封鎖**（方向為收緊，非弱化，故不違反 §九.3）。
- **D2（§四.3 的適用範圍）**：BLOCK 時 Mode 2 的「達目標各間隔劑量表」處置方式。
  使用者裁決：**收進第二層折疊區並改標題為「外推參考（本案不可直接採用）」**，
  而非完全不顯示——保留「量測 AUC 仍有效」的既有透明度。
