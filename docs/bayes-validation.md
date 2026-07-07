# Mode 3（Bayesian）驗證報告

> 對象：`js/bayes.js` 的 Goti 2018 二室 MAP 引擎。
> 可重跑：`node js/bayes.validation.js`（加 `--json` 只印摘要、`--n <N>` 調樣本數）。
> 回歸基準：`node js/bayes.golden.test.js`。
>
> **鐵則**：不得以「往返一致 / 自洽」宣告驗證完成。每層須有**獨立於 `simulateConc()`(RK4)** 的錨點。
> 本報告涵蓋 L1（解析解 oracle）、L2（模擬-估計）。L3（模型錯配）為選配、L4（外部臨床）待真實資料。

---

## L1 — 獨立解析解 oracle（硬 gate）✅ PASS

**目的**：打破 round-trip 循環性。既有 `bayes.test.js` 的 forward/inverse 共用同一 `simulateConc()`，結構性錯誤會兩端對消而仍 PASS。L1 以**完全獨立**的二室多次輸注封閉解當錨點。

**方法**：由微觀速率 k10/k12/k21 導巨觀混成常數 α/β（α+β=k10+k12+k21，αβ=k10·k21），零階輸注反應為單位脈衝反應之積分，多劑線性疊加（`analyticConc`，不呼叫 `simulateConc`）。

**斷言**：任意 PK 參數 × 給藥史 × 取樣點，RK4 vs 解析解**相對誤差 < 0.1%**。

**結果**：20 案（4 組 PK × 5 情境，含腎損 / 透析 / 輸注中取樣 / 非穩態）全數通過，
**最大相對誤差 ≈ 1.4×10⁻⁷ %**（≈ 8 位有效數字一致）→ RK4 模擬器正確，L2 可在正確模型上進行。

> gate 規則：L1 未過**不得**進 L2（否則是在錯模型上「無偏」，數字漂亮卻無效）。

---

## L2 — Simulation-Estimation（核心 Bayesian 驗證）

**目的**：若 Goti 為真，估計器對「個體 AUC24」是否無偏、精度與 shrinkage 如何。
**界線**：本層**僅**證「模型正確時估計器無偏」，**不**證 Goti 適用台灣族群（→ L4）。

**方法**：由 Goti 抽 N=1000 虛擬病人（共變數隨機；η~N(0,Ω) 用 `GOTI.OMEGA2`）。以**獨立解析解** `analyticConc` 生真實濃度 + combined 殘差（`ERR_PROP` 22.7% + `ERR_ADD` 3.4），再用**實際引擎** `bayesianMAP` 估計。真值 AUC24 = 每日總量 / CL_true，估計 AUC24 = 每日總量 / CL_est。種子固定（可重現）。

**通過標準**：以**無偏性**為硬指標——峰+谷、兩隨機 `|rBias| ≤ 5%`。
precision（rRMSE）與 coverage 為**描述性、非 gate**：Goti 殘差極大（谷≈10 mg/L 時 SD≈4.1、**41% CV**），單/雙點 AUC 的 rRMSE 本有 ~20–25% 下限，強套 ≤20% 不切實際。

**結果（N=1000，seed 20260707；規範化為 AUC24 相對誤差 = AUC_est/AUC_true − 1）：**

| 情境 | n | rBias% | rRMSE% | ±20% | ±30% | shrCL | shrVc | shrVp |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 單谷（trough-only） | 1000 | −2.98 | 24.13 | 0.60 | 0.79 | 0.27 | 0.79 | 0.86 |
| **峰+谷（peak+trough）** | 1000 | **−2.43** | 23.33 | 0.62 | 0.80 | 0.21 | 0.43 | 0.85 |
| 兩隨機（two-random） | 1000 | −1.39 | 23.52 | 0.62 | 0.80 | 0.25 | 0.53 | 0.84 |
| 非穩態首劑後（nonSS-1stdose） | 1000 | +8.08 | 41.33 | 0.40 | 0.59 | 0.77 | 0.58 | 0.72 |

shrinkage = 1 − SD(η_EBE)/ω（越接近 1＝越貼先驗、資料資訊量越低）。

**L2 判定：PASS**（峰+谷 rBias −2.4%、兩隨機 −1.4%，皆 |rBias|≤5%）。

**判讀**：
- 峰+谷、兩隨機、單谷的 rBias 皆近 0（−1.4~−3.0%，估計器**無偏**）；rRMSE ~23–24%（由 41% CV 殘差主導）。
- **非穩態首劑後**：rBias +8%、rRMSE 41%、shrCL 0.77——單一早期谷對 CL 資訊量低，估計被先驗拉回，故偏差與不精確度明顯較高。此結果**獨立佐證** v0.3.0 對非穩態取樣標「穩態投影」並降低信心的設計。
- 對照 **Broeker 2019**（外部真實資料、含模型錯配：Goti 類模型 rBias 約 ±10–20%、RMSE 約 20–40%）：本層無模型錯配，故 **rBias 明顯優於** Broeker（近 0）屬預期；rRMSE 落其區間**下緣**（由殘差主導，非估計器缺陷）。峰+谷 rRMSE 若近 0（<2%）反而是洩漏/bug 徵兆——**未出現**。

---

## L3 — 模型錯配 robustness（選配，未執行）

真值改由擾動參數 / Crass 2018 肥胖模型產生，仍以 Goti 先驗估計，報告 AUC 偏差並標肥胖 / ARC 高風險族群。此層量化「模型不完全正確時」的退化，預期 rBias/rRMSE 向 Broeker 靠攏。**規劃於 v0.4.0（Crass 先驗）前後。**

---

## L4 — 外部臨床錨點（PENDING，待真實資料，不 gate 上線）

L2 僅證「模型正確時無偏」，**無法**取代真實病人對照。此層需使用者提供資料，**禁以 L2 模擬數據冒充 L4 宣稱**。

**所需資料格式**（每案一列，去識別化；病患辨識欄位不得出現）：

| 欄位 | 說明 |
|---|---|
| case_id | 去識別化流水號 |
| age / sex / weight_kg / height_cm / scr | 共變數（採血當時）|
| dialysis | 是否間歇性 HD |
| dosing_history | 給藥事件列：每劑 `time(h) / dose(mg) / tInf(h)`（time 相對第一劑）|
| levels | 濃度列：每點 `time(h) / conc(mg/L)`（同一時間基準）|
| reference_AUC24 | 對照真值來源：**富取樣 trapezoidal AUC** 或 **商用 Bayesian**（PrecisePK / DoseMe）|
| reference_source | 上述何者 + 版本 / 模型 |

**產出**（資料到位後）：本工具 AUC_est vs reference 的比對表 + Bland-Altman（rBias、95% LoA），依族群（正常腎 / 肥胖 / 腎損 / HD）分層。

---

## 版本

- v0.3.1（2026-07-07）：L1 建立並通過（硬 gate）；L2 完成（N=1000）；golden-master 凍結。L3/L4 未執行。
