# 覆核判定（Reviewer of Reviewers）

- **日期**：2026-08-05
- **對象**：`.ai-review/codex-review.md`（Codex 獨立覆審）
- **base commit**：`ba62fd1`｜審查範圍：v0.5.0 結果頁四層重構（未提交）
- **覆核方式**：每一項均回讀該檔該行；CR-2／CR-3／TG-4 另以 node 實際重現。
- **幻覺檢查**：抽驗 12 處引用行號（`summary.js:193/78/383`、`ui.js:302/410/607/481/778/204/373/658`、`index.html:259/401`）**全部命中實際程式碼**，未發現不存在的 API 或檔案。Codex 確實讀了原始碼。

## 統計

**接受 13｜部分接受 6｜拒絕 0**

Codex 未提出任何與零建置／無框架／無 DOM 測試環境等架構限制衝突的建議，前提有被吸收。
特別值得記錄：CR-9 我在 prompt 裡引導它把「自訂試算 badge 重算 AUC 分級」視為可能的第二份閘門，
**Codex 拒絕了這個引導**，正確論證該處不影響 `allowDoseRecommendation`、只決定 what-if badge 顏色，
因此評為 Low。這是負面測試通過，提高我對其餘判斷的信任。

## 逐項判定

| # | 項目 | Codex 嚴重度 | 判定 | 覆核嚴重度 | 理由 |
|---|------|------|------|------|------|
| CR-1 | BLOCK 後自訂試算仍寫入臨床簡版 Plan | High | **部分接受**（嚴重度低估） | **Critical** | 屬實。`js/ui.js:464` 與 `js/ui.js:735` 的 `clinical += '\n\n' + extra` **無任何 `sum.blocked` 守衛**，`extra` 由 `js/ui.js:450` 的 `customLine()` 產生，內含 `${c.dose} mg q${c.tau}h`。畫面 `renderSummary()` 正確隱藏建議、可複製文字卻洩漏具體新劑量 → 直接違反 §四.3／§十.8。升為 Critical 的理由：這是**預設**複製按鈕的內容，且落點是病歷，正是威脅模型第 1 順位「閘門該關時洩漏具體新劑量」。附加的「此試算同不可靠」警語不能抵銷 §十.8 的絕對禁令 |
| CR-2 | 缺少／不完整 verdict 時 fail-open | High | **接受** | High | 屬實且已重現。`js/summary.js:196` 的 `sf.allowCalculation !== false`（`sf = safety \|\| {}`）使「沒有 verdict」＝「允許」。實測：`buildClinicalSummary(view, undefined, 2)` → `blocked=false`、輸出 `1500 mg q12h`，Plan 含新劑量；傳入 `{status:'BLOCK', messages:[]}` 但缺兩個布林欄位時同樣放行。安全邊界的預設值方向錯誤。Codex 建議的 `hasVerdict` fail-closed 可行——`SAFETY.verdict()`／`merge()` 一律產出這兩個布林，不會誤傷正常路徑 |
| CR-3 | `classifyLocal()` fallback 未限 Mode 1 | Medium | **部分接受**（嚴重度低估） | **High** | 屬實且已重現。`js/summary.js:201` 為 `aucStatusFromSafety(sf) \|\| classifyLocal(r.auc24)`，無 mode 守衛，但 `js/summary.js:69` 的 JSDoc 宣稱「僅 Mode 1」——註解與實作不符。實測 Mode 2 未傳 `auc` 時：狀態顯示「高於目標」、閘門仍開、輸出 `1500 mg q12h`，判讀與行為分歧。依我在 prompt 中自訂的評分軸「任何閘門／判讀邏輯被複製成第二份、可能與 safety.js 分歧者評 High 以上」，Codex 此處低估。**惟須註明：目前三個呼叫端 Mode 2/3 都有傳 `auc`，故為潛在缺陷而非現行可觸發路徑** |
| CR-4 | `GATE_LABEL` 需與 safety 人工雙邊同步 | Medium | **部分接受**（修法過重） | Medium | 問題屬實，`js/summary.js:78` 確實維護第二份「哪些 code 會擋」的清單，且失同步時若另有已知 code，新成因會**靜默消失**（比退回 generic 更糟）——這點 Codex 分析正確。但建議修法（safety verdict 回傳結構化 `doseRecommendationBlockers`）等於改動安全層的回傳契約，牽動 `safety.test.js` 51 項與三個呼叫端，代價高於收益。**較相稱的作法**：`safety.js` 的 `msg()` 增加選填第 4 參數 `blocksDose`，或退而求其次——把 S24 的案例表擴充到涵蓋目前所有會關閘門的 code（`B_NONFINITE`／`B_NO_CONVERGE`／`B_UNSTABLE`／`C_*`／`AUC_NONFINITE`）。後者不改任何生產程式碼 |
| CR-5 | 計算失敗訊息落在預設收合的第四層 | Medium | **部分接受**（嚴重度低估） | **High** | 屬實，且是**本次重構引入的迴歸**（重構前 `warnings` 是頂層永遠可見）。`js/ui.js:810` `alertResult()` 與 `js/ui.js:538` `alertBayes()` 都清空 `-summary` 後只寫入 `-warnings`，而該容器位於 `index.html:142/259/401` 的 `<details class="layer">`——**三處皆無 `open` 屬性**。實際結果：使用者按下計算後第一屏只剩兩顆複製按鈕與三個收合標題。Mode 3 的 `!allowCalculation`（Bayesian 未收斂／NaN／小兒／CRRT）走同一路徑，直接違反 §八.8「所有 BLOCK 都必須有明確下一步」→ 升 High |
| CR-6 | BLOCK caveat 宣稱「量測 AUC₂₄ 本身仍有效」 | Medium | **接受** | Medium | 屬實。`js/ui.js:411` 對**所有** Mode 2 閘門成因輸出同一句尾，但 `js/safety.js:141` 的 `E_SAMPLE_TIMING` 訊息明寫「AUC 估計標為不可信」。兩句會同屏出現、直接互斥。此句原本繼承自只有 AKI 會關閘門的年代（當時正確），這次擴大成因後未同步修訂。Codex 的中性改寫方向正確：保留顯示 ≠ 宣稱有效 |
| CR-7 | WARNING caveat 未置於建議旁、且可能列三項 | Medium | **部分接受** | Medium | 問題屬實：`js/ui.js:89-101` 的建議區只有 headline／loading／impractical／預估，**確實沒有 caveat**，WARNING 只出現在後方「主要限制」。違反 §四.2「在建議旁顯示單一明確 caveat」。惟 Codex 未指出 §四.2 與 §三.E（限制 1–3 項）在規格層面本就並存，修法須**兩者都保留**：新增 `recommendation.caveat`（取排序最高的一項）緊鄰建議，其餘仍留在限制區——不是把限制區砍到一項 |
| CR-8 | `metric()` 等未統一 `esc()` | Low | **接受** | Low | 屬實，`js/ui.js:30-35` 直接插值 label／value／unit。依威脅模型（無外部資料源、無 URL 參數、無 fetch、所有輸入為 `parseFloat` 後的 number）目前無可觸發路徑，Codex 自己也如此標註，嚴重度評 Low 正確。屬防禦性補強，非必修 |
| CR-9 | 自訂試算 badge 重複分類 + 寫死 400–600 | Low | **接受** | Low | 屬實。`js/ui.js:481`／`js/ui.js:778` 各自用 `VANCO` 重算 high/low/ok，`js/ui.js:491`／`js/ui.js:788` 的 badge 文字寫死「目標 400–600」而未引用 `VANCO.AUC_TARGET_MIN/MAX`。**Codex 正確判定此處不是第二份 safety gate**（不影響 `allowDoseRecommendation`、不進主摘要），拒絕了我 prompt 中的引導。僅屬顯示層重複與常數硬編碼 |
| TG-1 | S23 測不到 UI 對 Plan 的二次加工 | High | **接受** | High | 屬實，且正是「測不出東西的斷言」。`js/summary.test.js` 的 S23 只呼叫 `buildClinicalPlan(sm)`，而違規發生在 `ui.js` 拿到回傳值**之後**才附加。CR-1 的缺陷現正存在、S23 全綠 —— 這正是此類測試最該攔而沒攔的形態。Codex 建議抽出 `appendCustomSimulation()` 純函式後測試，與零建置架構相容 |
| TG-2 | S09 只比長度與第一項 | Medium | **部分接受**（修法可更強） | Medium | 屬實，`js/summary.test.js` 的 S09 斷言 `length === ... && [0] === [0]`，複製一份 hard-coded 也會過。Codex 說「注入 provider」較理想但擔心可行性——**實際上完全可行且零依賴**：`summary.js:307` 是 `SF.auc600Management()`（呼叫時才查屬性），測試中直接 `S.auc600Management = () => ['X']` 即可讓摘要輸出跟著變，這才是真正載重的斷言。比 Codex 退而求其次的 `deepStrictEqual` 更好 |
| TG-3 | S24 無法攔截未來新增 blocker | Medium | **部分接受** | Medium | 屬實（與 CR-4 同源）。現行 `blockCases` 六例確實未涵蓋 `B_NONFINITE`／`B_NO_CONVERGE`／`B_UNSTABLE`／`C_*`／`AUC_NONFINITE`，雖然這些 code **都已有** `GATE_LABEL` 對映。修法同 CR-4：優先擴充案例表（零生產程式碼變動），結構化 metadata 列為後續選項 |
| TG-4 | `technical.formula` 分支在真實管線從未成立 | Medium | **接受** | Medium | 屬實且已重現：`grep 'formula:' js/ui.js` → **0 次**，三個 view-model（`ui.js:204`／`373`／`658`）都沒寫入該欄位，`summary.js:383` 的 `if (t.formula)` 是死分支；S30 卻用 fixture 自己塞了 `technical.formula` 來證明 formatter 會顯示它。這正是我在 prompt 中要求它找的「宣稱的欄位從未產生」形態，**它在我自己的程式碼裡找到了一個**。後果：「複製完整 PK 報告」不含計算式／模型細節，與 §十.10 有落差（公式仍可在 DOM 折疊區看到，故非全失） |
| TG-5 | S39 只驗兩個詞存在 | Low | **接受** | Low | 屬實，弱斷言。優先度低於 TG-1/TG-2 |
| TG-6 | 三個 view-model 組裝完全無測試 | High | **接受** | High | 屬實。`ui.js:204`／`373`／`658` 的攤平邏輯是「PK 結果 → summary 契約」的唯一橋樑，填反 `currentExposure` 與 `recommend`、漏設 `aucIsProjection` 都不會被任何測試發現，而後果是臨床數值錯置。Codex 建議抽成 IIFE 雙掛載純函式再用 node 測——**與本專案既有模式完全一致**（`safety.js`／`summary.js` 都是這樣寫的），無需任何新依賴。這是本次最有價值的結構性建議 |
| TG-7 | 失敗流程與收合區互動無測試 | Medium | **接受** | Medium | 屬實，與 CR-5 同源。修 CR-5 時應一併補 |
| TG-8 | AUC 邊界 400／600／非有限值未測 | Medium | **接受** | Medium | 屬實。現行只測 500／320／684。邊界語意值得釘死：`safety.js:293` 為 `auc > 600` 才 high、`auc < 400` 才 low，故 **400 與 600 皆屬達標**，這個包含性應有測試保護 |
| TG-9 | Mode 1 摘要覆蓋最少 | Medium | **接受** | Medium | 屬實。Mode 1 目前只有 S11–S13 三條、且全在 AKI 特例。Codex 對「廣度看 Mode 1、風險看 Mode 3」的區分準確 |
| DA-1 | Google Fonts 跨源依賴 | Low | **部分接受**（非本次引入） | Low | 事實正確（`index.html:23-25`），但**屬既有設計、非本次改動引入**，且 `sw.js` 的註解與 README 都已明確揭露「跨源不攔截、離線退回系統字型」。列為已知取捨即可，不應計入本次必修 |
| DA-2 | `sw.js:53` 註解稱「背景補網」但實作未實作 | Low | **接受**（既有問題） | Low | 屬實，`sw.js:54` 命中快取後直接回傳、不觸發背景 fetch。非本次引入。Codex 同時正確確認了本次 SW 變更：CACHE v6→v7、`js/summary.js` 已入 shell、載入順序 safety → summary → ui 正確、15 個路徑均存在 |
| SA-1〜SA-5 | 規格符合度稽核 | — | 併入 CR-1／CR-5／CR-3／CR-7／TG-4 | — | 五項均為區塊 1／2 對應項的規格視角重述，無新增獨立發現。其逐條核對表中「§二.2 符合／§三.A 符合／§六.1-6.2 符合／§八.5 符合／§八.7 符合／§十.11 符合／§十.12 符合」等判定，我已回讀 `index.html:126-127/214-215/355-356`（預設鈕確為臨床簡版且帶 primary class）與 `summary.js:129/151`（`MAX_LIMITATIONS = 3` 確實生效）逐一確認，成立 |

## 必修項（Critical／High 且判定為接受或部分接受）

1. **CR-1（Critical）** — BLOCK 時自訂試算的具體 regimen 洩漏進**預設**複製內容。`js/ui.js:464`、`js/ui.js:735`。
2. **CR-2（High）** — `buildClinicalSummary()` 對缺失 verdict fail-open。`js/summary.js:196`。
3. **CR-3（High）** — `classifyLocal()` fallback 未限 Mode 1，判讀可與閘門分歧（目前潛在）。`js/summary.js:201`。
4. **CR-5（High）** — 計算失敗／Bayesian BLOCK 時第一屏全空，違反 §八.8。`js/ui.js:810`、`js/ui.js:538`、`index.html:142/259/401`。
5. **TG-1（High）** — S23 測不到 UI 二次加工，正是 CR-1 漏網的原因。
6. **TG-6（High）** — 三個 view-model 組裝零測試。

## 建議處理順序

| 順位 | 項目 | 理由 |
|---|---|---|
| 1 | **CR-1 + TG-1** | 一起做。抽出 `appendCustomSimulation(plan, custom, summary, kind)` 純函式，BLOCK 時臨床版只留「曾執行自訂試算、因安全閘門未納入」不帶 dose/tau，技術版可保留；同時補上會轉紅的測試 |
| 2 | **CR-2** | 改 `hasVerdict` fail-closed，四行改動，風險最低、防護最廣 |
| 3 | **CR-5 + TG-7** | 新增第一層 fatal-error 摘要（沿用「資料不足 + 原因 + 下一步」既有版型），修掉本次引入的迴歸 |
| 4 | **CR-3** | `classifyLocal` 加 `mode === 1` 守衛，並讓註解與實作一致 |
| 5 | **TG-6** | 抽出三個 `build*ViewModel()` 純函式 —— 做完這步，CR-2／CR-3 的迴歸測試才寫得出來，也順帶降低 CR-9 的重複 |
| 6 | CR-6、CR-7、TG-2、TG-3／CR-4、TG-4、TG-8、TG-9 | Medium 群，可批次處理。CR-6 只是改一句文字，可提前 |
| 7 | CR-8、CR-9、DA-1、DA-2 | Low，或列入 backlog。DA-1／DA-2 屬既有問題，不必綁在本次 |

## 處理狀態（2026-08-05 下午，v0.5.1）

必修 6 項全數處理完畢，另順帶結清 CR-6 與 TG-4。

| 項目 | 處置 | 落點 |
|---|---|---|
| CR-1 + TG-1 | 抽出 `SUMMARY.customSimulationNote()` / `appendCustomSimulation()`；BLOCK 時臨床簡版只留「曾執行自訂試算、因安全閘門未納入」＋成因，不帶 dose／tau／暴露量；技術版保留數值並標明不可靠。UI 兩處 `clinical += extra` 移除 | `summary.js`、`ui.js` `rebuildTextsA/B`｜S43–S48 |
| CR-2 | `hasVerdict` fail-closed：verdict 缺漏或欄位非布林一律不可計算、不可建議 | `summary.js` `buildClinicalSummary`｜S49–S51 |
| CR-3 | `classifyLocal()` 退回判讀加 `mode === 1` 守衛，Mode 2/3 無 AUC 分級即「資料不足」；註解與實作一致 | `summary.js`｜S52–S53 |
| CR-5 + TG-7 | 新增 `SUMMARY.buildFatalSummary()`（與摘要同形、`current: null`），`alertResult()`／`alertBayes()`／Mode 2 `!r.ok` 全改走第一層渲染，含原因與明確下一步；`renderSummary` 支援 `current: null` | `summary.js`、`ui.js`、瀏覽器實測三模式｜S54–S57 |
| TG-6 | 新增 `js/viewmodel.js`：三個 `build*ViewModel()` 純函式（IIFE 雙掛載，同 safety/summary 慣例），`ui.js` 只剩取值與渲染 | 新檔＋`index.html`／`sw.js`（v7→v8）｜V01–V34 |
| CR-6 | 移除「量測 AUC₂₄ 本身仍有效」——與 `E_SAMPLE_TIMING` 訊息互斥；改為中性敘述「照原樣顯示，可靠度以成因為準」 | `ui.js` Mode 2 caveat |
| TG-4 | `technical.formula` 改由 view-model 產生，第三層 DOM 與「複製完整 PK 報告」共用同一份字串，死分支消除 | `viewmodel.js`｜V19–V20、瀏覽器實測 |

### 第二批（Medium／Low 群）

| 項目 | 處置 | 落點 |
|---|---|---|
| CR-7 | 新增 `recommendation.caveat`：仍給建議時取排序最高的一項緊鄰建議（畫面 `.summary__caveat`、Plan 以 `※` 起首），該項不再重複列進限制區 | `summary.js`、`ui.js`、`style.css`｜S26／S26b／S40／S42／S54 |
| TG-2 | S09 改注入 provider：替換 `S.auc600Management` 後摘要與 Plan 須同步改變 | `summary.test.js`｜S09 |
| CR-4／TG-3 | `blockCases` 6 → 16 例，涵蓋所有 `GATE_LABEL` 碼；另加 S24b（block 級訊息皆須有對映，防新碼靜默消失）與 S24c（`GATE_LABEL` 每個碼都有案例覆蓋，防表項腐化）。未改安全層回傳契約 | `summary.test.js` |
| TG-8 | AUC 邊界：400／600 皆屬達標（包含性）、399.6／600.4 翻面、NaN 走資料不足且不吐 NaN 到畫面 | S43–S47 |
| TG-9 | Mode 1 摘要補 7 例（起始 vs 調整、無現行方案、負荷有無／封頂、信心與監測、AUC 標為預估、AKI caveat） | S48–S54 |
| TG-5 | S39 改驗「醫囑格式 regimen 與模型預測數值不同行、預估行不帶 `Vancomycin`」，把兩者併成一行即轉紅 | `summary.test.js`｜S39 |
| CR-8 | `metric()` 三個插值點統一 `esc()` | `ui.js` |
| CR-9 | 兩處 what-if badge 改用 `SUMMARY.classifyDisplay()`／`displayTag()`，目標區間改引用 `VANCO` 常數；函式註解明寫「非閘門」 | `ui.js`、`summary.js`｜S70／S71 |
| DA-2 | `sw.js` 註解與實作對齊：純 cache-first、不做背景補網，汰換靠版本號（背景補單檔會造成混版） | `sw.js` |
| SP-1 | **375px 版面已量測**（同源 iframe 375×812，實測視埠 375）：三模式皆無頁面級橫向捲動；寬表格於 `.table-scroll`（`overflow-x:auto`）內自行捲動。發現複製鈕高 38px 低於觸控目標，已加 `@media(max-width:560px){.btn--copy{min-height:44px}}`，複測 44px | `style.css` |

**測試**：173 → 239（summary 42→74、新增 viewmodel 34）。全綠，golden-master 逐位相同（`748.675049`）。
**變異驗證**：summary 6 條、view-model 8 條、第二批 10 條全數轉紅。兩次假綠已修正——V29（恆真斷言，改為跨門檻兩側比對）、Mode 2／Mode 3 fixture（建議劑量恰等於現行劑量，互換暴露量測不出來，改用暴露不足的案例）。
**未處理**：DA-1（Google Fonts 跨源，屬既有設計取捨，`sw.js` 註解與 README 均已揭露）。
Service Worker CACHE v7 → v9（v8 新增 `summary.js`／`viewmodel.js`，v9 為 CSS 變更）。

## 邊界聲明

本次覆核**全程唯讀**，未修改任何 source code；僅寫入 `.ai-review/plan.md`、`.ai-review/codex-review.md`、`.ai-review/verdict.md`。修不修、怎麼修由使用者決定。
