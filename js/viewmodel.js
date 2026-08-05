/**
 * viewmodel.js — PK 計算結果 → 摘要契約（v0.5.1）
 *
 * 三個模式各自把自己的 PK 回傳攤平成 summary.js 的 result 契約。
 * 抽出成純函式的理由：這是「數值 → 臨床摘要」的唯一橋樑，把 currentExposure 與
 * recommend 填反、漏設 aucIsProjection，任何 PK 測試都不會轉紅，後果卻是臨床數值錯置。
 *
 * 邊界：純函式、無 DOM、不做 PK 計算、不做任何安全判斷。
 * 閘門一律由 safety.js 決定、由 summary.js 消費；此處只負責搬運與字串排版。
 */
(function (root) {
  const isNode = (typeof require !== 'undefined');
  const C = isNode ? require('./constants.js') : root;
  const VANCO = C.VANCO;

  const f = (v, d = 1) => (isFinite(v) ? v.toFixed(d) : '—');
  const list = (xs) => xs.filter(Boolean);

  // ---------- Mode 1：經驗起始 ----------
  /**
   * @param {object} i
   *   r        PK.empiricDosing() 的回傳
   *   targetAuc 目標 AUC（滑桿值）
   *   icu      是否重症（決定是否給負荷劑量）
   *   demo     { age, sexLabel, tbw, heightCm, scr }
   *   declared { declaredAKI, pregnant, cysticFibrosis }
   */
  function buildEmpiricViewModel(i) {
    const r = i.r, d = i.demo || {}, dec = i.declared || {};
    const crass = r.clModel === 'crass';
    const clLabel = crass ? '族群 CLV (Crass 肥胖)' : '族群 CLvanco (Matzke)';
    const loadLabel = crass ? '負荷劑量 (nomogram)' : '負荷劑量 (TBW)';
    const tInfNote = `峰/谷預測固定假設輸注 ${VANCO.EMPIRIC_TINF_H}h；延長輸注後實際峰值略低、AUC 不變`;

    return {
      regimenCurrent: null,
      currentExposure: null,
      auc24: r.predictedAuc24,
      aucLabel: '建議方案預估 AUC24',
      targetAuc: i.targetAuc,
      recommend: {
        dose: r.maintenanceDose, tau: r.maintenanceInterval, dailyMg: r.maintenanceDailyMg,
        auc24: r.predictedAuc24, peak: r.predictedPeak, trough: r.predictedTrough,
      },
      loading: i.icu ? { dose: r.loadingDose, capped: r.loadingCapped } : null,
      alternatives: [],
      confidenceFactors: list([
        dec.declaredAKI && 'AKI',
        dec.pregnant && '懷孕',
        dec.cysticFibrosis && 'CF',
      ]),
      confidenceBaseNote: '經驗起始（無實測濃度）→ 須及早採濃度驗證',
      patient: `${d.age}歲 ${d.sexLabel}，${d.tbw}kg / ${d.heightCm}cm（BMI ${f(r.bmi, 1)}），SCr ${d.scr} mg/dL`,
      technical: {
        method: crass ? '經驗起始（Crass 2018 肥胖 CL 模型）' : '經驗起始（Matzke 族群 CL）',
        clLabel, loadLabel,
        lines: [
          `CrCl (Cockcroft-Gault，${r.crclWeight.label} ${f(r.crclWeight.weight, 1)}kg) = ${f(r.crcl, 0)} mL/min`,
          `${clLabel} = ${f(r.clPop, 2)} L/h；Vd = ${f(r.vdPop, 1)} L`,
          `IBW ${f(r.ibw, 1)} kg；BMI ${f(r.bmi, 1)} kg/m²`,
          `理想日劑量（目標 AUC ${i.targetAuc} × CL）= ${f(r.tddTarget, 0)} mg/day → 圓整 ${r.maintenanceDose} mg q${r.maintenanceInterval}h（${f(r.maintenanceDailyMg, 0)} mg/day）`,
        ].concat(
          i.icu ? [`${loadLabel} = ${r.loadingDose} mg${r.loadingCapped ? '（已封頂 3000 mg）' : ''}`] : [],
          crass && r.nomogram ? [`Crass nomogram 對照：${r.nomogram.maint} mg q${r.nomogram.tau}h（CLV≈${r.nomogram.clv}、負荷 ${r.nomogram.load}）`] : [],
          [tInfNote]
        ),
      },
    };
  }

  // ---------- Mode 2：雙點反算 ----------
  /**
   * @param {object} i
   *   r        PK.twoLevelAUC() 的回傳（須 r.ok）
   *   input    { dose, tau, tInf, c1, t1, c2, t2, mic }
   *   recOpt   主推薦的 intervalOption（維持原間隔）
   *   declared { declaredAKI, declaredUnreliableDoseTiming, declaredUnreliableSampleTiming, pregnant, cysticFibrosis }
   */
  function buildTwoLevelViewModel(i) {
    const r = i.r, x = i.input, rec = i.recOpt, dec = i.declared || {};
    return {
      regimenCurrent: { dose: x.dose, tau: x.tau, tInf: x.tInf, dailyMg: r.tddCurrent },
      currentExposure: { auc24: r.auc24, peak: r.cMaxTrue, trough: r.cMinTrue },
      auc24: r.auc24, mic: x.mic, aucOverMic: r.aucOverMic,
      targetAuc: (VANCO.AUC_TARGET_MIN + VANCO.AUC_TARGET_MAX) / 2,
      recommend: {
        dose: rec.doseMg, tau: rec.intervalH, dailyMg: rec.dailyMg,
        auc24: rec.projectedAuc24, peak: rec.projectedPeak, trough: rec.projectedTrough,
        impractical: rec.impractical,
      },
      alternatives: r.intervalOptions.map((o) => ({
        dose: o.doseMg, tau: o.intervalH, dailyMg: o.dailyMg,
        auc24: o.projectedAuc24, peak: o.projectedPeak, trough: o.projectedTrough,
        impractical: o.impractical, isCurrent: o.intervalH === x.tau,
      })),
      confidenceFactors: list([
        (x.t1 - x.tInf) < 1 && '峰採樣接近分布相',
        dec.declaredAKI && 'AKI',
        dec.declaredUnreliableDoseTiming && '給藥時間不可靠',
        dec.declaredUnreliableSampleTiming && '採血時間不可靠',
        dec.pregnant && '懷孕',
        dec.cysticFibrosis && 'CF',
      ]),
      confidenceBaseNote: '穩態雙點量測、取樣時相合理',
      technical: {
        method: '雙點反算（Sawchuk-Zaske first-order、兩段式 AUC）',
        lines: [
          `ke ${f(r.ke, 4)} /h、t½ ${f(r.halfLife, 1)} h、Vd ${f(r.vd, 1)} L、CL ${f(r.cl, 2)} L/h`,
          `真峰/真谷 ${f(r.cMaxTrue, 1)}/${f(r.cMinTrue, 1)} mg/L`,
          `AUC_τ ${f(r.aucTau, 1)}（輸注段 ${f(r.aucInfusion, 1)} + 消除段 ${f(r.aucElim, 1)}）`,
          `交叉驗證 TDD/CL = ${f(r.auc24Check, 1)}（應與 AUC₂₄ 相近）`,
          `目前每日 ${f(r.tddCurrent, 0)} mg → 達 AUC 500 需約 ${f(r.tddTarget, 0)} mg/day（比例線性外推）`,
        ],
        // 同一份字串同時供第三層 DOM 與「複製完整 PK 報告」使用，避免兩處各寫一份。
        formula:
          `ke = ln(${x.c1}/${x.c2}) / (${x.t2}−${x.t1}) = ${f(r.ke, 4)} /h\n`
          + `真峰 Cmax(輸注末) = ${x.c1} × e^(ke×(${x.t1}−${x.tInf})) = ${f(r.cMaxTrue, 2)} mg/L\n`
          + `真谷 Cmin(間隔末) = ${x.c2} × e^(−ke×(${x.tau}−${x.t2})) = ${f(r.cMinTrue, 2)} mg/L\n`
          + `AUC_τ = 輸注梯形 (${f(r.aucInfusion, 1)}) + 消除對數梯形 (${f(r.aucElim, 1)}) = ${f(r.aucTau, 1)} mg·h/L\n`
          + `AUC₂₄ = AUC_τ × (24/${x.tau}) = ${f(r.auc24, 1)} mg·h/L\n`
          + `交叉驗證 TDD/CL = ${f(r.tddCurrent, 0)}/${f(r.cl, 2)} = ${f(r.auc24Check, 1)}（應相近）`,
      },
    };
  }

  // ---------- Mode 3：Bayesian MAP ----------
  /**
   * @param {object} i
   *   r        BAYES.bayesianMAP() 的回傳
   *   dose/tau/tInf/nDose  現行方案
   *   levels   [{ conc, tRel }]
   *   steadyState 是否近穩態（由 UI 依有效半衰期判定，此處只搬運）
   *   mic, targetAuc
   *   recDose  同間隔達目標 AUC 的建議劑量（圓整後）
   *   recExp / curExp  BAYES.steadyStateExposure() 的回傳（建議方案 / 現行方案）
   *   demo     { age, sexLabel, tbw, heightCm, scr, dialysis }
   *   declared { declaredAKI, declaredUnreliableDoseTiming, declaredUnreliableSampleTiming, pregnant, cysticFibrosis }
   */
  function buildBayesViewModel(i) {
    const r = i.r, d = i.demo || {}, dec = i.declared || {};
    const auc = r.auc24Current;
    const shrink = (eta) => `${eta >= 0 ? '+' : ''}${(eta * 100).toFixed(0)}%`;
    const lv = i.levels.map((l, n) => `C${n + 1} ${l.conc} mg/L @最近一劑後 ${l.tRel}h`).join('、');
    const clStatus = r.eta.cl > 0.05 ? '清除較族群先驗快'
      : r.eta.cl < -0.05 ? '清除較族群先驗慢' : '清除接近族群先驗';

    return {
      regimenCurrent: { dose: i.dose, tau: i.tau, tInf: i.tInf, dailyMg: i.dose * (24 / i.tau), nDose: i.nDose },
      currentExposure: { auc24: auc, peak: i.curExp.peak, trough: i.curExp.trough },
      auc24: auc, aucIsProjection: !i.steadyState,
      mic: i.mic, aucOverMic: auc / i.mic, targetAuc: i.targetAuc,
      recommend: {
        dose: i.recDose, tau: i.tau, dailyMg: i.recDose * (24 / i.tau),
        auc24: i.recExp.auc24, peak: i.recExp.peak, trough: i.recExp.trough,
        impractical: i.recDose > VANCO.MAINT_PERDOSE_PRACTICAL_MAX,
      },
      alternatives: [],
      confidenceFactors: list([
        i.levels.length === 1 && '單一濃度',
        !i.steadyState && '非穩態',
        d.dialysis && '血液透析',
        dec.declaredAKI && 'AKI',
        dec.declaredUnreliableDoseTiming && '給藥時間不可靠',
        dec.declaredUnreliableSampleTiming && '採血時間不可靠',
        dec.pregnant && '懷孕',
        dec.cysticFibrosis && 'CF',
      ]),
      confidenceBaseNote: '穩態雙點，資訊量佳（L2 shrinkage ~0.21）',
      patient: `${d.age}歲 ${d.sexLabel}，${d.tbw}kg / ${d.heightCm}cm，SCr ${d.scr}${d.dialysis ? '，血液透析' : ''}`,
      technical: {
        method: 'Bayesian MAP（Goti 2018 二室先驗）',
        lines: [
          `濃度：${lv}`,
          `個體 CL ${f(r.cl, 2)} L/h（先驗 ${f(r.prior.cl, 2)}，η ${shrink(r.eta.cl)}）→ ${clStatus}`,
          `Vc ${f(r.vc, 1)} L、Vp ${f(r.vp, 1)} L、Vss ${f(r.vss, 1)} L、Q ${f(r.q, 1)} L/h`,
          `CrCl ${f(r.crcl, 0)} mL/min；目標函數 Obj ${f(r.objective, 3)}；擬合最大殘差 ${f(r.maxAbsResid, 1)} mg/L`,
          `取樣：${i.levels.length === 1 ? '單一濃度（Vc/Vp 主要仰賴先驗）' : '雙點'}${i.steadyState ? '、已達近穩態' : '、非穩態（AUC 為穩態投影）'}`,
        ],
        formula:
          '先驗（Goti 2018，共變數代入）：\n'
          + `  TVCL = 4.5×(CrCl/120)^0.8×0.7^DIAL = ${f(r.prior.cl, 3)} L/h\n`
          + `  TVVc = 58.4×(WT/70)×0.5^DIAL = ${f(r.prior.vc, 2)} L；Vp ${f(r.prior.vp, 1)}；Q ${f(r.prior.q, 1)}\n`
          + `MAP 個體 η（P=TVP×e^η）：ηCL ${f(r.eta.cl, 3)}、ηVc ${f(r.eta.vc, 3)}、ηVp ${f(r.eta.vp, 3)}\n`
          + `目標函數 Obj = Σ(Cpred−Cobs)²/SD² + Σηₖ²/ωₖ² = ${f(r.objective, 3)}\n`
          + `AUC₂₄ = 每日總量 / 個體 CL = ${f(i.dose * (24 / i.tau), 0)} / ${f(r.cl, 2)} = ${f(auc, 1)} mg·h/L`,
      },
    };
  }

  const api = { buildEmpiricViewModel, buildTwoLevelViewModel, buildBayesViewModel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VIEWMODEL = api;
})(typeof self !== 'undefined' ? self : this);
