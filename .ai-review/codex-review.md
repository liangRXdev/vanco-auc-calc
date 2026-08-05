# Codex 獨立覆審報告

- **審查日期**：2026-08-05
- **覆審員**：Codex（MCP `mcp__codex__codex`，sandbox: `read-only`、approval-policy: `never`）
- **審查範圍**：未提交的工作區改動（相對 HEAD `ba62fd1`）＋未追蹤的 `js/summary.js`、`js/summary.test.js`
- **base commit**：`ba62fd1`（Merge pull request #1 from liangRXdev/feat/bayes-custom-regimen-sim）
- **規格基準**：`.ai-review/plan.md`

> 以下為 Codex 原始輸出，**未經修飾或刪改**，供稽核。判定見 `.ai-review/verdict.md`。

---

結論：共識別 **2 項 High、6 項 Medium、3 項 Low**。最重要問題是：

- BLOCK 後執行自訂試算，仍會把具體新 regimen 加進「臨床簡版 Plan」。
- `buildClinicalSummary()` 對缺少／不完整 safety verdict 採 fail-open，可能輸出劑量。
- 計算失敗訊息被寫進預設收合的第四層，第一層反而空白。
- 現有 173 項測試全部通過，但沒有涵蓋上述實際 UI 整合路徑。

已確認全程唯讀，未修改任何檔案。

## 區塊 1 — Code review

### CR-1

**js/ui.js:459、js/ui.js:727 / High / BLOCK 後自訂試算仍把具體 regimen 寫入臨床 Plan**

`rebuildTextsA()`／`rebuildTextsB()` 不論 `sum.blocked`，都會將：

```text
★ 自訂試算（使用者指定，非系統建議）：750 mg q12h
```

附加到 `clinical`。後方雖再加「安全閘門已擋下」警語，仍違反 §四.3、§十.8 與 README:75 宣稱的「臨床簡版不含任何具體新劑量」。

這也是畫面摘要與可複製 Plan 的實際分歧：`renderSummary()` 只看到 `s.blocked` 並正確隱藏建議，但 Plan 被 UI 在 `buildClinicalPlan()` 回傳後二次加工。

**建議修法：** `sum.blocked === true` 時，自訂試算只能留在畫面折疊區與技術完整版，不得附加到 `clinical`；或臨床版只加入「曾執行使用者自訂試算，因安全閘門關閉未納入 Plan」而不帶 dose/tau。另新增涵蓋「BLOCK → 執行 custom sim → copy clinical」的純函式測試。

---

### CR-2

**js/summary.js:193 / High / safety verdict 缺失或欄位不完整時 fail-open**

目前：

```js
const sf = safety || {};
const canCalculate = sf.allowCalculation !== false;
const canRecommend = canCalculate && sf.allowDoseRecommendation !== false;
```

因此 `safety` 為 `null`、`undefined`，或呼叫端漏傳旗標時，摘要會視為「可算、可建議」，並可能輸出 `r.recommend`。安全邊界不應把「沒有 verdict」解讀為允許。

現有 UI 都有傳入 verdict，但這個純函式已形成獨立契約；未來任何整合錯誤都會以最危險的方式失效。

**建議修法：** fail-closed：

```js
const hasVerdict = safety
  && typeof safety.allowCalculation === 'boolean'
  && typeof safety.allowDoseRecommendation === 'boolean';

const canCalculate = hasVerdict && safety.allowCalculation;
const canRecommend = canCalculate && safety.allowDoseRecommendation;
```

缺少 verdict 時狀態應為「資料不足」，原因標示「缺少 safety verdict」，不得輸出 regimen。

---

### CR-3

**js/summary.js:62、js/summary.js:69、js/summary.js:199 / Medium / 摘要仍有第二份 AUC 判讀規則**

`aucStatusFromSafety()` 優先讀 safety code，但只要沒有 `AUC_OK/LOW/HIGH`，所有 mode 都會落入 `classifyLocal()`，重新以 `VANCO` 判讀 AUC。

註解宣稱 fallback「僅 Mode 1」，實作卻未限制 mode。對 Mode 2/3 而言，可能形成：

- safety 沒有 AUC code；
- `classifyLocal()` 判為 high；
- `allowDoseRecommendation` 仍為 true；
- 摘要顯示「高於目標」，卻進入 `adjust` 並輸出新劑量。

這是狀態判讀分歧，不是直接複製完整 safety gate，但已違反 §九.7「摘要不得自行重新判讀 safety」。

**建議修法：** 只有 `mode === 1` 才允許 local display classification；Mode 2/3 缺 AUC code 時一律回 `insufficient`。更穩健的做法是 safety verdict 直接提供結構化 `aucStatus`，摘要完全不解讀訊息碼。

---

### CR-4

**js/summary.js:77 / Medium / `GATE_LABEL` 與 safety gate 需要人工雙邊同步**

`GATE_LABEL` 不決定是否 BLOCK，但會重新維護一份「哪些 safety code 是阻擋成因」的清單。未來 `safety.js` 新增令 `allowDoseRecommendation=false` 的 code 而漏改此表時：

- 若沒有其他已知 code：顯示 generic「本案安全閘門已擋下劑量建議」。
- 若同時有其他已知 code：新成因會靜默消失，只顯示部分原因。
- 閘門本身仍關閉，不會直接洩漏劑量，但臨床人員會收到不完整原因。

S24 只手動覆蓋六種案例，未覆蓋 Bayesian 三種 blocker、所有濃度 blocker、`AUC_NONFINITE`，也無法自動捕捉未來新增 code。

**建議修法：** 由 safety verdict 回傳結構化 `doseRecommendationBlockers`，或讓 message 帶 `blocksDoseRecommendation` 與 `shortText`。測試只需建立通則：`allowDoseRecommendation === false` 時 blockers 必須非空，便可攔截未來新增 code。

---

### CR-5

**js/ui.js:302、js/ui.js:607、index.html:259、index.html:401 / Medium / 計算失敗訊息被放進預設收合區**

Mode 2 `!r.ok` 與 Mode 3 `!sf.allowCalculation` 都會清空第一層摘要，將錯誤寫入 `a-warnings`／`b-warnings`。但本次重構已把這兩個容器移入沒有 `open` 的第四層 `<details>`。

實際結果是：

- 第一層臨床摘要空白；
- 使用者只看到空結果卡與複製按鈕；
- 真正失敗原因藏在「安全與適用性說明」內。

Bayesian fit failure 的錯誤分支雖存在，卻不會在第一屏實際呈現，屬「宣稱的失敗處理未實際可見」。

**建議修法：** 新增第一層專用 fatal-error 容器，或讓 `alertResult()`／`alertBayes()` 渲染「資料不足 + 原因 + 下一步」摘要。若仍使用第四層，錯誤時至少自動設定該 `<details>.open = true`，但第一層呈現仍較符合規格。

---

### CR-6

**js/ui.js:410 / Medium / 採血時間不可靠時仍宣稱「量測 AUC 本身仍有效」**

所有 Mode 2 BLOCK 都共用：

```text
量測 AUC₂₄ 本身仍有效。
```

但 `E_SAMPLE_TIMING` 的新 safety 訊息明確寫「AUC 估計標為不可信」。兩者同時出現時，畫面會自相矛盾。

刻意保留顯示 AUC 沒問題；問題是將「仍顯示供核對」誤寫成「仍有效」。

**建議修法：** 改成不重新判斷可靠性的中性文字，例如：

> 本次 AUC 仍保留顯示供核對，但不得據此外推新劑量；其可信度以 safety 訊息為準。

若要依原因改寫，文字應由 safety verdict 提供，不要在 UI 再判讀 code。

---

### CR-7

**js/ui.js:88、js/summary.js:265 / Medium / WARNING caveat 沒有依 §四.2 放在建議旁，且可能同時列三項**

`renderSummary()` 的建議區沒有 caveat；WARNING 只在後方「主要限制」區出現。多個 warning 時會列最多三項，而非 §四.2 要求的「建議旁單一明確 caveat」。

S26 只驗證 caveat 在 `limitations` 與 Plan 中出現，沒有驗證：

- 是否位於建議旁；
- 是否只有一個主要 caveat；
- 是否與主要建議形成清楚關聯。

**建議修法：** summary view-model 增加單一 `recommendation.caveat`，由 safety messages 排序選出最重要一項；其餘仍放 `limitations`。

---

### CR-8

**js/ui.js:30、js/ui.js:64、js/ui.js:94 / Low / HTML escaping 未完整封裝**

`metric()` 的 label/value/unit、`s.status.key`、`s.status.icon`、loading dose 等直接插入 HTML。現況多為內部字串或已轉成 number，依既定威脅模型實際風險低，未發現可由外部資料觸發的有效 XSS 路徑。

**建議修法：** 在 `metric()` 內統一 `esc()`；class modifier 使用 allowlist；所有 summary 動態文字一律 escape。這不需要框架或額外依賴。

---

### CR-9

**js/ui.js:481、js/ui.js:778 / Low / 自訂試算的 AUC badge 重複分類，但不算第二份 safety gate**

兩處使用 `VANCO` 重算 high/low/ok，只決定自訂 what-if badge 顏色與文字，沒有改動 `allowDoseRecommendation`、主摘要或 safety verdict，因此不屬第二份「劑量建議閘門」。

但它仍是重複的顯示分類，且 badge 文字把目標寫死為 `400–600`，未來常數變動可能出現判斷與文字不一致。

**建議修法：** 將「暴露狀態 → badge」抽成 summary.js 的純顯示 helper，兩模式共用；仍維持 classic script/IIFE，不需 ES module 或建置鏈。

## 區塊 2 — Test gap analysis

所有既有測試結果：

- `pk.test.js`：28/28
- `bayes.test.js`：31/31
- `safety.test.js`：51/51
- `summary.test.js`：42/42
- `bayes.golden.test.js`：21/21

合計 **173/173 通過**。

### TG-1

**js/summary.test.js:135 / High / S23 沒有涵蓋 UI 對 clinical Plan 的二次附加**

S23 只測 `buildClinicalPlan(sm)` 的直接輸出；真正違規發生在 `ui.js` 之後把 `planACustom`／`planBCustom` 附加到 clinical Plan。

因此目前實作已違反「BLOCK Plan 不含新 regimen」，S23 仍全綠。

**建議修法：** 抽出純函式 `appendCustomSimulation(plan, custom, summary, reportType)`；測試 BLOCK 下 clinical 不含 dose/tau，technical 可含且必須帶 caveat。

---

### TG-2

**js/summary.test.js:74 / Medium / S09 無法證明處置真的「直接取自 safety」**

S09 只比較陣列長度與第一個字串。即使 summary.js 複製一份完全相同的 hard-coded 處置，測試仍通過。

**建議修法：** 可驗證引用一致性，或更實用地暫時替換／注入 `auc600Management` provider，確認摘要輸出隨 provider 改變。至少應逐項 `deepStrictEqual`，而非只比第一項。

---

### TG-3

**js/summary.test.js:155 / Medium / S24 無法攔截未來新增 blocker**

S24 只枚舉六種案例，沒有從 safety verdict 的結構化 blocker 集合建立完整性不變量。

**建議修法：** safety 層提供 blockers metadata，測試通則為：

```text
allowDoseRecommendation=false
⇒ blockers.length >= 1
⇒ 每個 blocker 都有可顯示 shortText
```

---

### TG-4

**js/summary.test.js:192 / Medium / 測試產生了實際 UI 管線從未產生的 `technical.formula`**

S30 的 fixture 在 `mkResult()` 手動加入 `technical.formula`，所以測試證明 formatter 能顯示 formula；但 Mode 1/2/3 的 `viewE/viewA/viewB` 都沒有寫入該欄位。`summary.js:383` 的分支在真實管線中不會成立。

Mode 2/3 公式仍可在 DOM 折疊區看到，但「完整 PK 報告」複製文字不會走這條 formula 分支。

**建議修法：** 若完整文字版應含公式，view-model 應實際提供 `technical.formula`；若不需要，移除虛假的 S30 formula 斷言，改驗證真實 view-model 所產生的欄位。

---

### TG-5

**js/summary.test.js:220 / Low / S39 只驗證兩個詞存在，無法驗證標籤語意分離**

只要 Plan 任意位置仍有「建議：」與「預估 AUC24」，即使預測值被放在建議 headline、或畫面未分區，S39 仍會通過。

**建議修法：** 驗證 recommendation 結構含獨立 `headline` 與 exposure 區，並對產生的摘要 HTML／文字檢查順序與區塊邊界。

---

### TG-6

**js/ui.js:204、js/ui.js:373、js/ui.js:658 / High / 三個 view-model 組裝完全無測試**

最可能錯誤包括：

- `auc24` 與推薦方案 `recommend.auc24` 填反。
- current peak/trough 與 projected peak/trough 填反。
- Mode 3 漏設 `aucIsProjection`，非穩態 AUC 被呈現成實際當日暴露。
- safety 收到的 AUC 與 summary 顯示的 AUC 不是同一值。
- `recDose`、`tau`、`tInf` 或 `currentExposure` 對錯方案。
- Mode 2 `recOpt` fallback 選到非預期 interval。
- confidenceFactors 與 safety messages 分歧。

其中 Mode 3 的 mapping 最複雜、臨床後果最高。

**建議修法：** 不需 DOM 套件。把三段組裝抽成 IIFE 雙掛載的純函式，例如 `buildEmpiricViewModel()`、`buildTwoLevelViewModel()`、`buildBayesViewModel()`，直接用 Node 測試。

---

### TG-7

**js/ui.js:302、js/ui.js:607 / Medium / 失敗流程與收合區互動沒有測試**

沒有測試能發現錯誤訊息實際藏在 closed `<details>`，也沒有驗證失敗後第一層是否顯示「資料不足／下一步」。

**建議修法：** 在無 DOM 依賴前提下，把 fatal-error view-model 與 HTML 字串產生抽成純函式測試；另保留一份人工 smoke-test checklist，驗證三模式成功／失敗後第一屏可見內容。

---

### TG-8

**js/summary.test.js:40 / Medium / AUC 邊界沒有覆蓋 400、600 與非有限值**

目前摘要測 500、320、684，沒有測：

- 399.5／400；
- 600／600.5；
- `NaN`／`Infinity`；
- Mode 1 local display classification 的邊界。

這對 `classifyLocal()` 尤其重要。

**建議修法：** 新增精確邊界測試，並確認 600 仍達標、`>600` 才 high；Mode 2/3 缺 safety AUC code 時不得 local fallback。

---

### TG-9

**js/summary.test.js:82 / Medium / Mode 1 摘要行為覆蓋最少**

Mode 1 只測「AKI 仍給起始劑量」特殊案例，未測：

- 正常經驗起始；
- ICU loading dose 與 capped 標示；
- 非 ICU 不顯示 loading；
- 正常首次 TDM 建議；
- Matzke／Crass 兩種 view-model；
- 預測 AUC high/low 的顯示語意；
- 缺失或非有限 predicted exposure。

因此以「摘要行為廣度」而言，**Mode 1 最缺測試**；以「view-model mapping 複雜度與風險」而言則是 **Mode 3 最需要優先補測**。

## 區塊 3 — Dependency audit

### DA-1

**index.html:23 / Low / Google Fonts 是唯一隱性跨源 runtime 依賴**

頁面會連線到：

- `fonts.googleapis.com`
- `fonts.gstatic.com`

影響：

- 首次載入／未快取時，離線無法取得 Noto Sans TC、DM Mono，但會退回系統 sans-serif／monospace，計算功能不受影響。
- Google 可取得 IP、User-Agent 與頁面 referrer；不會取得使用者後續輸入的病人資料，因沒有 query、fetch 或後端傳輸。
- `preconnect` 會在尚未需要字型前就建立跨源連線。

**建議修法：** 若要完全離線與零第三方連線，可改用系統字型，或將必要 WOFF2 自行放入 app shell。兩者都相容於零建置架構，不需 npm。

### Service Worker 結論

`sw.js` 本次處理正確：

- `CACHE` 已由 v6 更新至 v7：`sw.js:6`。
- `js/summary.js` 已加入 app shell：`sw.js:15`。
- `index.html` 載入順序為 safety → summary → ui，正確。
- SHELL 列出的 15 個路徑均實際存在。
- 無外部圖片；favicon 與所有 PWA icons 都是同源本地資產。
- 跨源 Google Fonts 刻意不由 SW 攔截，離線降級方式與註解一致。

附帶一項既有 Low 問題：`sw.js:53` 註解稱「cache-first，背景補網」，但 `sw.js:54` 命中 cache 後不會背景 fetch。這不影響本次 v7 更新，因 cache version bump 會重新安裝 shell；屬既有註解／策略不一致。

## 區塊 4 — 規格符合度稽核

### SA-1

**§四.3／§十.8 + js/ui.js:459、js/ui.js:727 / High / BLOCK clinical Plan 仍可能包含自訂具體 regimen**

D2 只核可 Mode 2 劑量表留在第二層，未核可把自訂方案寫入 clinical Plan。實作較規格弱，詳見 CR-1。

**建議修法：** BLOCK 時 custom regimen 僅保留在折疊試算畫面與技術完整版。

---

### SA-2

**§八.8／§十.7 + js/ui.js:607、index.html:401 / Medium / Bayesian failure 沒有在第一層呈現下一步**

錯誤分支存在，但訊息進入預設收合的第四層；第一層摘要被清空。這不符合「所有 BLOCK 必須有明確下一步」。

**建議修法：** fatal failure 也產生 `資料不足` summary，第一層顯示原因與重新確認輸入／採血／給藥史的下一步。

---

### SA-3

**§九.7 + js/summary.js:69、js/summary.js:201 / Medium / Mode 2/3 仍可能由 summary 自行重判 AUC**

規格宣稱摘要消費 safety 結果；實作 fallback 未限定 Mode 1。

**建議修法：** local classification 僅限 Mode 1；其餘缺 safety AUC status 時 fail-closed。

---

### SA-4

**§四.2 + js/ui.js:88、js/summary.js:265 / Medium / WARNING 沒有「建議旁單一 caveat」**

實作把 caveat 放在後方 limitations，且最多可有三項；S26 驗證的是較弱性質。

**建議修法：** 增加單一 primary caveat，緊鄰推薦方案。

---

### SA-5

**§六.2／§十.10 + js/summary.js:383、js/ui.js:390、js/ui.js:671 / Low / `technical.formula` 支援分支在真實管線從未產生**

技術報告 formatter 宣稱可輸出公式／模型細節，測試 fixture 也宣稱涵蓋；但實際三模式 view-model 未提供 `technical.formula`。公式只存在 DOM 折疊區。

**建議修法：** 明確裁決完整文字版是否應包含公式；若應包含就從 view-model 傳入，若不應包含就移除誤導性測試與死分支。

### 指定條款逐條核對

| 條款 | 結果 | 實作依據 |
|---|---|---|
| §二.2 第一屏無 η/shrinkage/objective/Vc/Vp/Q/公式/全部候選 | 符合 | `index.html:220、245、361、385` 均置於 closed details |
| §三.A 狀態不只靠顏色 | 符合 | `ui.js:62–66` 有 icon＋文字 badge |
| §三.E 限制最多 3 項 | 符合 | `summary.js:129、151` |
| §四.3 BLOCK 不得顯示具體新劑量 | **部分不符合** | 主摘要正確；custom clinical Plan 違反，D2 表格例外處理正確 |
| §六.1/6.2 預設複製為臨床簡版 | 符合 | `index.html:126–127、214–215、355–356`；clinical button 有 primary class |
| §八.5 AUC 整數、peak/trough 一位 | 符合 | `ui.js:73、98–99`；`summary.js:283–305` |
| §八.7 建議與預估分標籤 | 符合 | `ui.js:91、97`；但 S39 測試偏弱 |
| §九.6 DOM 不散落臨床判斷 | 部分符合 | 主閘門集中；confidence factors、sim badge 與 Mode 2 caveat 仍有展示判斷散落 |
| §九.7 摘要不得重判 safety | **部分不符合** | 閘門讀 verdict，但 AUC fallback 未限 Mode 1 |
| §十.1 AUC 400–600 達標且不調整 | 基本符合 | S01–S04；缺精確 400/600 邊界 |
| §十.2 AUC <400 顯示主要方案 | 符合 | S05–S07 |
| §十.3 AUC >600 顯示處置 | 符合 | S08–S10；S09 斷言偏弱 |
| §十.4 AKI 依模式處理 | 符合 | S11–S15 |
| §十.5 採血時間不可靠禁新劑量 | 符合 D1 | `safety.js:139–145`、S16–S17 |
| §十.6 HD 禁 individualized recommendation | 符合 | S18–S19 |
| §十.7 Bayesian fit failure禁新劑量 | 邏輯符合、呈現不足 | S20–S21；實際錯誤藏在第四層 |
| §十.8 BLOCK Plan 無任何新 regimen | **不符合** | custom simulation 可繞過 S23 |
| §十.9 WARNING caveat 在摘要與 Plan | 基本符合 | S25–S26；未達「建議旁單一 caveat」 |
| §十.10 技術完整版保留必要資訊 | 基本符合 | PK、safety、candidate 有保留；formula 管線為空 |
| §十.11 所有既有測試與 golden 通過 | 符合 | 173/173 |
| §十.12 UI 重構不改計算結果 | 符合現有證據 | constants/pk/bayes 未改，PK/Bayes/golden 全通過 |

整體判定：核心四層 IA 與主摘要閘門方向正確，但在合併前至少應修正 **CR-1（BLOCK Plan 劑量洩漏）**、**CR-2（fail-open verdict）** 與 **CR-5（失敗訊息不可見）**。
