/**
 * bayes.js — 萬古黴素 Bayesian MAP 藥動學個體化（Phase 2）
 *
 * 方法：以 Goti 2018 二室族群 PK 模型為先驗（prior），用病人 1+ 個實測濃度
 * 更新，最小化 MAP 目標函數求個體最可能的 CL/Vc/Vp，再由個體 CL 算 AUC24。
 *   目標函數（Sheiner-Beal 1979）：
 *     Obj(η) = Σ_obs (Cpred−Cobs)² / SD² + Σ_k η_k² / ω²_k
 *   個體參數 P = TVP × exp(η)，η ~ N(0, ω²)。
 *
 * 二室動力學以 RK4 積分（piecewise-constant 輸注率，支援非穩態/任意給藥史）。
 * 最佳化用 Nelder-Mead simplex（3 維 η：CL/Vc/Vp）。
 *
 * 對應 wiki: concept-Bayesian-MAP-estimation、source-goti2018-vancomycin-popPK-HD、
 *           source-chen2022-bayesian-method-vancomycin。
 *
 * 依賴 constants.js 的 GOTI。臨床數值全部集中於 GOTI，不寫死於此。
 */
(function (root) {
  const C = (typeof require !== 'undefined') ? require('./constants.js') : root;
  const GOTI = C.GOTI;

  // ---------- 先驗：共變數 → 族群典型值 ----------
  /**
   * Goti Cockcroft-Gault CrCL（忠於原模型截斷規則）。
   * SCr<1 且年齡>60 → SCr=1；CrCL 上限截斷 150。
   * weightKg 應為 CG 慣用體重（消瘦 TBW / 肥胖 AdjBW），由呼叫端決定。
   */
  function gotiCrCl(age, weightKg, scr, sexMale) {
    let s = scr;
    if (s < GOTI.ELDERLY_SCR_FLOOR && age > GOTI.ELDERLY_AGE) s = GOTI.ELDERLY_SCR_FLOOR;
    let crcl = ((140 - age) * weightKg) / (72 * s);
    if (!sexMale) crcl *= 0.85;
    return Math.min(crcl, GOTI.CRCL_CAP);
  }

  /**
   * 由共變數算族群典型值 TVCL/TVVc/TVVp/TVQ。
   * cov: { crcl (mL/min), weightKg (體積用實際體重 TBW), dialysis (bool) }
   */
  function priorTypicalValues(cov) {
    const dial = cov.dialysis ? 1 : 0;
    const tvcl = GOTI.CL_POP
      * Math.pow(cov.crcl / GOTI.CRCL_REF, GOTI.CRCL_EXP)
      * Math.pow(GOTI.DIAL_CL, dial);
    const tvvc = GOTI.VC_POP
      * (cov.weightKg / GOTI.WT_REF)
      * Math.pow(GOTI.DIAL_VC, dial);
    return { cl: tvcl, vc: tvvc, vp: GOTI.VP, q: GOTI.Q };
  }

  // ---------- 二室 IV 輸注模擬（RK4，piecewise-constant R）----------
  /**
   * 模擬中央室濃度於指定觀測時刻。
   * doses: [{ time (h,起始), dose (mg), tInf (h) }]（time 為距 t0 的絕對時刻）
   * obsTimes: 觀測時刻陣列 (h)
   * pk: { cl, vc, vp, q }
   * 回傳與 obsTimes 對齊的濃度陣列 (mg/L)。
   */
  function simulateConc(doses, obsTimes, pk) {
    const k10 = pk.cl / pk.vc;
    const k12 = pk.q / pk.vc;
    const k21 = pk.q / pk.vp;

    // 輸注率查詢：某時刻 t 的總輸注率 (mg/h)
    function rateAt(t) {
      let r = 0;
      for (const d of doses) {
        if (t >= d.time && t < d.time + d.tInf) r += d.dose / d.tInf;
      }
      return r;
    }

    // 斷點：輸注起訖 + 觀測時刻 + 0，確保每段內 R 為常數（RK4 對 piecewise 精確）
    const bpSet = new Set([0]);
    for (const d of doses) { bpSet.add(d.time); bpSet.add(d.time + d.tInf); }
    for (const t of obsTimes) bpSet.add(t);
    const tEnd = Math.max(...obsTimes, ...doses.map((d) => d.time + d.tInf));
    const breakpoints = [...bpSet].filter((t) => t <= tEnd + 1e-9).sort((a, b) => a - b);

    const obsSorted = [...new Set(obsTimes)].sort((a, b) => a - b);
    const obsSet = new Set(obsSorted); // 觀測時刻查表（obs 時刻已加入 breakpoints，浮點值一致）
    const result = new Map();

    let a1 = 0, a2 = 0, t = 0;
    const MAX_DT = 0.05; // h，段內細分步長

    // f: 導數（段內 R 常數）
    function deriv(A1, A2, R) {
      return [R - (k10 + k12) * A1 + k21 * A2, k12 * A1 - k21 * A2];
    }

    if (obsSorted[0] === 0) result.set(0, a1 / pk.vc);

    for (let i = 0; i < breakpoints.length - 1; i++) {
      const segStart = breakpoints[i];
      const segEnd = breakpoints[i + 1];
      const segLen = segEnd - segStart;
      if (segLen <= 1e-12) continue;
      const R = rateAt((segStart + segEnd) / 2); // 段中點 R（段內恆定）
      const nSteps = Math.max(1, Math.ceil(segLen / MAX_DT));
      const dt = segLen / nSteps;
      for (let s = 0; s < nSteps; s++) {
        const [d1a, d2a] = deriv(a1, a2, R);
        const [d1b, d2b] = deriv(a1 + 0.5 * dt * d1a, a2 + 0.5 * dt * d2a, R);
        const [d1c, d2c] = deriv(a1 + 0.5 * dt * d1b, a2 + 0.5 * dt * d2b, R);
        const [d1d, d2d] = deriv(a1 + dt * d1c, a2 + dt * d2c, R);
        a1 += (dt / 6) * (d1a + 2 * d1b + 2 * d1c + d1d);
        a2 += (dt / 6) * (d2a + 2 * d2b + 2 * d2c + d2d);
        t += dt;
      }
      t = segEnd; // 消弭累積浮點漂移
      if (obsSet.has(segEnd)) result.set(segEnd, a1 / pk.vc);
    }
    // 守衛：任何未被捕捉的觀測時刻回傳 NaN（而非 undefined），
    // 讓上游 objective/bayesianMAP 能偵測非有限值並轉為 BLOCK，不致靜默吐垃圾。
    return obsTimes.map((ot) => (result.has(ot) ? result.get(ot) : NaN));
  }

  // ---------- MAP 目標函數 ----------
  /** combined 殘差 SD（以預測濃度計）：√((prop·C)² + add²) */
  function residualSD(cpred) {
    return Math.sqrt(Math.pow(GOTI.ERR_PROP * cpred, 2) + Math.pow(GOTI.ERR_ADD, 2));
  }

  /**
   * 目標函數：對 η=[ηCL,ηVc,ηVp] 求值。
   * tv: 族群典型值；doses/obs：資料。obs: [{ time, conc }]
   */
  function objective(eta, tv, doses, obs) {
    const pk = {
      cl: tv.cl * Math.exp(eta[0]),
      vc: tv.vc * Math.exp(eta[1]),
      vp: tv.vp * Math.exp(eta[2]),
      q: tv.q,
    };
    const times = obs.map((o) => o.time);
    const cpred = simulateConc(doses, times, pk);
    let ll = 0; // 概似項
    for (let i = 0; i < obs.length; i++) {
      const cp = cpred[i];
      const sd = residualSD(cp);
      ll += Math.pow(cp - obs[i].conc, 2) / (sd * sd);
    }
    // 先驗懲罰項
    const pen = eta[0] * eta[0] / GOTI.OMEGA2_CL
              + eta[1] * eta[1] / GOTI.OMEGA2_VC
              + eta[2] * eta[2] / GOTI.OMEGA2_VP;
    return ll + pen;
  }

  // ---------- Nelder-Mead simplex（3 維）----------
  function nelderMead(fn, x0, opts) {
    const o = Object.assign({ maxIter: 400, tol: 1e-8, step: 0.3 }, opts || {});
    const n = x0.length;
    // 初始 simplex
    let simplex = [x0.slice()];
    for (let i = 0; i < n; i++) {
      const p = x0.slice();
      p[i] += o.step;
      simplex.push(p);
    }
    let f = simplex.map(fn);
    const order = () => {
      const idx = f.map((v, i) => i).sort((a, b) => f[a] - f[b]);
      simplex = idx.map((i) => simplex[i]);
      f = idx.map((i) => f[i]);
    };
    const A = 1, G = 2, R = 0.5, S = 0.5; // 反射/擴張/收縮/縮小係數

    let converged = false;
    let usedIter = o.maxIter;
    for (let iter = 0; iter < o.maxIter; iter++) {
      order();
      if (Math.abs(f[n] - f[0]) < o.tol) { converged = true; usedIter = iter; break; }
      // 形心（除最差點）
      const cen = new Array(n).fill(0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) cen[j] += simplex[i][j] / n;
      // 反射
      const xr = cen.map((c, j) => c + A * (c - simplex[n][j]));
      const fr = fn(xr);
      if (fr < f[0]) {
        const xe = cen.map((c, j) => c + G * (xr[j] - c));
        const fe = fn(xe);
        if (fe < fr) { simplex[n] = xe; f[n] = fe; } else { simplex[n] = xr; f[n] = fr; }
      } else if (fr < f[n - 1]) {
        simplex[n] = xr; f[n] = fr;
      } else {
        const xc = cen.map((c, j) => c + R * (simplex[n][j] - c));
        const fc = fn(xc);
        if (fc < f[n]) { simplex[n] = xc; f[n] = fc; }
        else { // 縮小
          for (let i = 1; i <= n; i++) {
            simplex[i] = simplex[i].map((v, j) => simplex[0][j] + S * (v - simplex[0][j]));
            f[i] = fn(simplex[i]);
          }
        }
      }
    }
    order();
    return { x: simplex[0], fval: f[0], converged, iters: usedIter };
  }

  // ---------- 頂層：Bayesian MAP 估計 ----------
  /**
   * input: {
   *   cov: { age, weightKg, scr, sexMale, dialysis } // weightKg：CrCL 用體重（呼叫端已選 TBW/AdjBW）
   *   tbw,                                            // 體積用實際體重（Vc 正規化）
   *   doses: [{ time, dose, tInf }],
   *   obs:   [{ time, conc }],
   *   currentDailyDose?,   // 現行維持日劑量（mg/day），供 AUC24 計算
   * }
   * 回傳個體 PK + AUC24 + 建議 TDD 函式。
   */
  function bayesianMAP(input) {
    const cov = input.cov;
    const crcl = gotiCrCl(cov.age, cov.weightKg, cov.scr, cov.sexMale);
    const tv = priorTypicalValues({ crcl, weightKg: input.tbw, dialysis: cov.dialysis });

    const obs = input.obs || [];
    let eta = [0, 0, 0];
    let fval = objective(eta, tv, input.doses, obs);
    let converged = true;      // 無觀測時＝純先驗，視為收斂
    let fitReliable = true;    // 多起點是否一致（optimizer 未靜默失敗）
    if (obs.length > 0) {
      const fn = (e) => objective(e, tv, input.doses, obs);
      // 多起點：單起點 Nelder-Mead 易靜默收斂到 local min / 平坦區。
      // 從先驗中心與四個偏移點各跑一次，取最佳 fval，並檢查各解 CL 是否一致。
      const starts = [[0, 0, 0], [0.5, -0.4, 0.2], [-0.5, 0.4, -0.2], [0.3, 0.3, 0.3], [-0.3, -0.3, -0.3]];
      const runs = starts
        .map((s) => nelderMead(fn, s, { step: 0.3 }))
        .filter((r) => isFinite(r.fval));
      if (runs.length === 0) {
        converged = false; fitReliable = false; // 全部非有限（NaN 濃度等）
      } else {
        runs.sort((a, b) => a.fval - b.fval);
        eta = runs[0].x; fval = runs[0].fval;
        converged = runs[0].converged;
        // 一致性：取 fval 接近最佳者（Δfval<1），比較其個體 CL 相對散布
        const best = runs[0].fval;
        const cls = runs.filter((r) => r.fval - best < 1).map((r) => tv.cl * Math.exp(r.x[0]));
        const spread = (Math.max(...cls) - Math.min(...cls)) / Math.min(...cls);
        fitReliable = converged && spread < 0.05; // CL 各起點差 <5% 視為可靠
      }
    }

    const cl = tv.cl * Math.exp(eta[0]);
    const vc = tv.vc * Math.exp(eta[1]);
    const vp = tv.vp * Math.exp(eta[2]);
    const q = tv.q;

    // AUC24 = 每日總量 / 個體 CL（線性 PK，與室數無關）
    const auc24 = (dailyDose) => dailyDose / cl;
    // 達目標 AUC 所需每日總量
    const recommendTDD = (targetAuc) => targetAuc * cl;

    const times = obs.map((o) => o.time);
    const predAtObs = simulateConc(input.doses, times, { cl, vc, vp, q });

    // 殘差與有限性守衛：任一預測非有限（NaN/Inf）即標記，供 safety 轉 BLOCK。
    const resids = obs.map((o, i) => predAtObs[i] - o.conc);
    const nonFinite = !isFinite(cl) || !isFinite(auc24Value(input.currentDailyDose, cl))
      || predAtObs.some((c) => !isFinite(c));
    const maxAbsResid = resids.length ? Math.max(...resids.map((d) => Math.abs(d))) : 0;

    return {
      crcl,
      prior: tv,
      eta: { cl: eta[0], vc: eta[1], vp: eta[2] },
      cl, vc, vp, q,
      vss: vc + vp,                         // 穩態分布體積 (L)
      objective: fval,
      converged,        // optimizer 是否收斂（未耗盡 maxIter）
      fitReliable,      // 多起點 CL 是否一致（未靜默失敗）
      nonFinite,        // 有無非有限輸出（NaN/Inf）
      maxAbsResid,      // 擬合最大絕對殘差 (mg/L)
      auc24, recommendTDD,
      auc24Current: input.currentDailyDose != null ? input.currentDailyDose / cl : null,
      predictedAtObs: obs.map((o, i) => ({ time: o.time, observed: o.conc, predicted: predAtObs[i] })),
    };
  }

  /** currentDailyDose 可能為 null；null 時回傳有限值（0）以免 nonFinite 誤判。 */
  function auc24Value(dailyDose, cl) {
    return dailyDose != null ? dailyDose / cl : 0;
  }

  /**
   * 以個體 PK 模擬某方案（dose/tau/tInf）的穩態峰(輸注末)、谷(間隔末)、AUC24。
   * 供結果頁「建議劑量」顯示；模擬至穩態（≥15 劑或 ~10 天）。
   */
  function steadyStateExposure(dose, tau, tInf, pk) {
    const N = Math.max(15, Math.ceil(240 / tau));
    const doses = [];
    for (let i = 0; i < N; i++) doses.push({ time: i * tau, dose, tInf });
    const last = (N - 1) * tau;
    const [peak, trough] = simulateConc(doses, [last + tInf, last + tau], pk);
    return { peak, trough, auc24: dose * (24 / tau) / pk.cl };
  }

  const api = {
    gotiCrCl, priorTypicalValues, simulateConc,
    residualSD, objective, nelderMead, bayesianMAP, steadyStateExposure,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BAYES = api;
})(typeof self !== 'undefined' ? self : this);
