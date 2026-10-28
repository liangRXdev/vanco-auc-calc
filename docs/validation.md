# 臨床交叉驗證案例表（vs ClinCalc）

> **範圍**：本檔僅涵蓋 **Mode 1/2**（一室、Sawchuk-Zaske）數值交叉核對。
> **Mode 3（Bayesian）驗證**另立 `docs/bayes-validation.md`（L1 獨立解析解 → L2 模擬-估計 → L4 外部臨床錨點；規劃於 v0.3.1，建置中）。
> 現行 Mode 3 僅有內部自洽（往返一致 / 自洽回復）＝ verification，**非 clinical validation**。

部署公開前，用下列案例把本工具輸出對照 [clincalc.com/vancomycin](https://clincalc.com/vancomycin/)（或院內既有工具）核對。
「本工具」欄已預先算好；「ClinCalc」與「一致？」欄請比對後手動填。

> 本工具數字由 `node -e`（載入 `js/pk.js`）產生，與網頁一致。

## 比對前設定與容差

- **Mode 2（雙點）是主要數值驗證**：ClinCalc 選 **Two Levels（Sawchuk-Zaske / first-order）**，非 Bayesian，才是同演算法比對。
  - 容差：**CrCl 應完全一致**；**ke / Vd / CL 誤差 <5%**；**AUC24 誤差 <5–10%**（AUC 積分法可能略異）。
- **Mode 1（經驗）主要驗 CrCl**：本工具維持劑量用 **guideline mg/kg**，ClinCalc empiric 用 **pop-PK 逼近 AUC**，方法不同 → **劑量預期會有差異，非錯誤**。CrCl（Cockcroft-Gault）應完全相同。
- **時間慣例對齊**：本工具的「時刻」＝距**本次輸注開始**的小時數。ClinCalc 輸入 level 時間時，請換算成同一基準（峰 @3h＝1h 輸注結束後 2h）。

---

## Mode 1 — 經驗起始劑量

> **2026-07-03 已修正**：原 mg/kg 維持劑量系統性衝破 AUC（實測對應 AUC 769/987/1496）。改為**族群 CL（Matzke）反推目標 AUC**（預設 500，可調），與 Mode 2/ClinCalc 同邏輯。下表為修正後數字。

| 案例 | 輸入 | 本工具 CrCl | CL(Matzke) | 本工具 負荷 / 維持 (目標AUC500) | 預測AUC | ClinCalc 負荷/維持 | 一致？ |
|------|------|-----------|-----------|------------------------------|--------|------------------|-------|
| **A 正常腎** | 60歲 男, 175cm, 80kg, SCr 1.0 | **89** | 3.90 L/h | 1750 / **1000 q12h（2000/d）** | **513** | 2000 / 750 q12h（1500/d）| 同數量級（我 AUC500、ClinCalc ~400）|
| **B 腎損** | 75歲 男, 170cm, 70kg, SCr 2.5 | **25** | 1.27 L/h | 1500 / **750 q24h（750/d）** | **592** | 1750 / 1000 q36h（666/d）| ✅ 接近 |
| **C 肥胖女** | 55歲 女, 165cm, 120kg, SCr 0.9 | **92** | 4.01 L/h | 2750 / **750 q8h（2250/d）** | **561** | 3000 / 1750 q24h（1750/d）| 我略高；肥胖用 Crass CLV（Phase 2）會更貼 |

> 修正前為 A 3000/d、B 1250/d、C 6000/d（AUC 769/987/1496）——已淘汰。
> 注意：CrCl 體重＝Cockcroft-Gault 用（肥胖 AdjBW）；負荷 mg/kg 用 TBW；維持用族群 CL 反推 AUC。
> 剩餘與 ClinCalc 差距＝目標 AUC 取值（我中點 500 vs ClinCalc 偏保守 ~400，滑桿可下調）＋肥胖 pop-PK 模型差異。

---

## Mode 2 — 雙點反算 AUC（主要數值驗證）

| 案例 | 方案 | 濃度 | 本工具 ke | t½ | Vd | CL | 峰 / 谷 | **AUC24** | ClinCalc AUC24 | 一致(<10%)？ |
|------|------|------|----------|----|----|----|--------|----------|---------------|-------------|
| **D 標準** | 1000 mg q12h, 輸注 1h | 峰 20@3h, 谷 7@11.5h | 0.1235 | 5.6h | 47.5L | 5.87 | 25.6 / 6.6 | **340** |341 |一致 |
| **E** | 1250 mg q12h, 輸注 1.5h | 峰 25@2.5h, 谷 8@11h | 0.1341 | 5.2h | 49.5L | 6.64 | 28.6 / 7.0 | **375** |383 |一致 |
| **F 腎損 q24** | 1500 mg q24h, 輸注 1.5h | 峰 28@3h, 谷 12@23h | 0.0424 | 16.4h | 76.3L | 3.23 | 29.8 / 11.5 | **464** |464 |一致 |

各案例另可比對 ClinCalc 的 **ke / Vd / CL / 預測峰谷**（欄位省略，數值如上）。

---

## 安全守衛與輸入政策（2026-10 審查修正）

> 下列守衛不改變上表案例 A–F 的任何數值（A/B/C 之 SCr ≥ 0.7、CrCl < 150；Mode 2 τ 皆為標準間隔）。
> 對應測試：`js/guards.test.js`（端到端重現）、`js/safety.test.js` C40–C48、`js/pk.test.js` #2/#5、`js/bayes.test.js` #4/#6。

| 守衛 | 觸發條件 | 處置 | 碼 / 位置 |
|------|---------|------|----------|
| 模型輸出範圍（三模式） | CL ≤ 0、建議單次或日劑量 ≤ 0、任一為非有限值 | **BLOCK**：不出劑量、摘要不顯示 AUC | `E_MODEL_OUT_OF_RANGE`（safety.checkModelOutput） |
| Crass CLV 下限 | Crass 模型估計 CLV < 0.5 L/h（Table 2 footnote a） | **BLOCK**（原為 warn）；提示改用 Matzke + 密集 TDM | `E_CRASS_CLV_LOW` |
| 日劑量上限 | 建議日劑量 > 4500 mg/day（Rec 13） | WARNING（所有病人，不限肥胖） | `DOSE_DAILY_HIGH` |
| Mode 1 輸入範圍 | 超出 `VANCO.RANGES`：年齡 18–120、身高 120–220 cm、TBW 30–300 kg、SCr 0.1–15 mg/dL | 不計算（alertResult） | `PK.validateEmpiricInput` |
| Mode 2 穩態前提 | 未勾選「已達穩態（已給 ≥ 4 劑同一方案）」 | 顯示量測 AUC，但**不出劑量建議**，建議改用 Mode 3 | `DQ_M2_NOT_STEADY` |
| Mode 2 間隔表 | 圓整後劑量為 0 mg 的間隔列 | 不列入替代方案，表格標示「不適用」 | viewmodel / ui |
| Mode 2 非標準 τ | 現行 τ ∉ {8, 12, 24, 48} | 以現行 τ 自算一列作主推薦（不再退回 q12h） | `PK.currentIntervalOption` |
| Mode 3 時序 | tInf ≥ τ；tRel < 0 或 > τ；劑數非正整數；負荷劑量 ≤ 0 或負荷輸注 ≥ τ | 不計算，錯誤訊息指名欄位與數值 | `BAYES.validateRegimenTiming` |

### Cockcroft-Gault SCr 下限 0.7 mg/dL（機構政策，Mode 1）

- 實測 SCr < 0.7 mg/dL 時，Mode 1 的 Cockcroft-Gault 以 **0.7 代入**；結果頁「影響因子」、第三層 PK 與技術報告標示「SCr 已以 0.7 代入（機構政策）」。
- 理由：低 SCr 多反映肌肉量少（臥床、高齡、營養不良）而非腎功能佳，直接代入會高估 CrCl 與族群 CL。審查重現：20 歲男 180 cm 80 kg SCr 0.2 原輸出 **4750 mg q8h** → 修正後 **1000 mg q8h**（預估 AUC 467）。
- 同時 **CrCl 封頂 150 mL/min**，與 Mode 3 `gotiCrCl`（`GOTI.CRCL_CAP`）一致。
- **不適用範圍**：Crass CLV 式本身仍用實測 SCr（模型共變數）；Mode 3 Goti 先驗維持原模型規則（年齡 > 60 且 SCr < 1 → 1）。兩者是否套用 0.7 下限列為待決。

### Mode 3 首劑（負荷）劑量

- 選填「首劑（負荷）劑量」與「負荷輸注時長」（預設同維持）；填入後給藥史第 1 劑改為負荷量。
- **有負荷劑量而未輸入時，模型以較少藥量擬合同一濃度 → CL 低估、AUC 高估**（測試案例：未填 808 vs 有填 636 mg·h/L）。未填時給藥史與舊版完全相同，golden G1–G3 不變。

---

## 判讀

- **Mode 2 三案 AUC24 全部 <10% 吻合（340/341、375/383、464/464）→ 核心 PK 引擎已驗證可信。** ✅
- **Mode 1 原 mg/kg 過衝已修正**為族群 CL 反推 AUC；三案預測 AUC 513/592/561 皆落 400–600，與 ClinCalc 同數量級。
- 剩餘小差異＝目標 AUC 取值 + 肥胖 pop-PK 模型（Crass CLV Phase 2），非 bug。

驗證完成後，將結果摘要記於 `wiki/log.md` 或本檔，並可移除本提示。
