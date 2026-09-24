# Vancomycin AUC Calculator (萬古黴素 AUC 導向劑量計算器)

**English** | [繁體中文](README.zh-TW.md)

An AUC-guided vancomycin dosing tool in Traditional Chinese: pure frontend, **installable PWA / works offline**, deployed on GitHub Pages.
Clinical data are centralized in `js/constants.js` rather than hard-coded in the logic.

> 📲 **PWA (v0.4.2)**: supports "Add to Home Screen / Install"; the service worker caches the full app shell → **fully offline calculation after the first load** (all same-origin HTML/CSS/JS is cached; fonts are cross-origin and fall back to system fonts offline, which does not affect calculation).

🔗 **Use it online**: https://liangrxdev.github.io/vanco-auc-calc/
> ⚕️ For clinical decision support only; does not replace professional judgment. All doses must be reviewed by a pharmacist/physician.

## Positioning

| | This tool | clincalc / vancocalc / vancopk |
|---|---|---|
| Language | **Traditional Chinese** | English |
| Method | Transparent (formulas and model parameters shown) | Mostly Bayesian |
| Bayesian | Goti 2018 two-compartment MAP, priors published |  |
| Deployment | Pure frontend, offline-capable, serverless | Mostly online-only |
| Evidence | Every recommendation links to its evidence source | — |

A GitHub survey found few vancomycin AUC tools built around a Traditional Chinese clinical-pharmacist workflow, deployed as pure frontend, and fully publishing their formulas and model parameters. The project's positioning is therefore "Traditional Chinese, transparent calculation, offline-capable, easy for pharmacists to review and teach with", rather than claiming market uniqueness or competitive differentiation.

## Features

**Mode 1 | Empirical starting dose** (no serum levels yet)
- Cockcroft-Gault CrCl → loading dose 20–25 mg/kg TBW (cap 3000)
- Maintenance: **back-calculated from population CL to a target AUC** (slider 400–600, default 500), not mg/kg
- ⚠ Why not mg/kg: 15–20 mg/kg q8–12h is a trough-era method that systematically overshoots AUC 400–600 (measured correspondence: AUC 770–1500). Instead `TDD = target AUC × population CL`, the same logic as Mode 2/ClinCalc. Cross-validated against ClinCalc (see `docs/validation.md`)
- **Selectable CL model (v0.4.0)**: Matzke (general population, default) or **Crass 2018 (obesity pop-PK)** — switching is suggested at BMI≥30. Crass `CLV = 9.656−0.078·Age−2.009·SCr+1.09·Sex+0.04·TBW^0.75` (one-compartment, TBW allometric), Vd stratified by BMI (0.8/0.52/0.42 L/kg), loading dose per nomogram (less is more, fixed 2500–3000). The computed maintenance dose is automatically compared against the Crass Table 2 nomogram (measured CLV6 → 1500 q12h, matching the nomogram). The UI suggests a model live based on BMI.
- **Data confidence + clinical declarations (v0.4.1)**: a badge on the results page shows confidence (empirical start with no measured level → Moderate); declarations for AKI / pregnancy / CF (no timing items, since there are no measured levels). AKI only lowers confidence and **still gives a starting dose** (an empirical start has to begin somewhere; the tool prompts a recheck within 24 h).

**Mode 2 | Two-level AUC back-calculation + adjustment** (two levels available)
- Two levels at any two times within an interval → Sawchuk-Zaske for ke/Vd/CL → **full two-part AUC** (infusion trapezoid + elimination log-trapezoid)
- Compared with target 400–600 → proportional linear extrapolation of dose suggestions for each interval
- **Data confidence + clinical declarations (v0.4.1)**: the badge is tiered by sampling phase and declarations (steady-state two levels + plausible timing → High); declarations for AKI / unreliable dosing or sampling times / pregnancy / CF. **AKI makes extrapolated maintenance doses unreliable** → caveat on the dose table and flagged in the Plan (but **the measured AUC itself remains valid and is shown as usual**).

**Mode 3 | Bayesian AUC** (1–2 levels, non-steady-state allowed)
- **Goti 2018 two-compartment population PK model** as the prior; RK4 simulates the dosing history, MAP (Sheiner-Beal objective function) + Nelder-Mead optimization for individual CL/Vc/Vp
- Advantage: AUC can be estimated from **a single level, at non-steady state, as early as after the first dose**
- Output: individual PK (prior → individual η), fit diagnostics, dose suggestion to reach target (steady-state peak/trough)
- **Custom regimen simulation (v0.4.3)**: after computing AUC, enter any dose / interval / infusion time to run a **two-compartment steady-state simulation** with this MAP individual PK, predicting the new regimen's peak/trough/AUC₂₄ and writing back a copyable Plan. Infusion time is editable — under a two-compartment model tInf really affects the peak (2000 mg q24h: 1 h vs 3 h peak differs by 5.2 mg/L). When a safety gate blocks dose recommendations (AKI / AUC>600 / HD) **simulation is still allowed but annotated with a warning**: a custom regimen is a user-specified what-if projection, semantically different from a recommendation made by the tool
- Safety gates (v0.3.0): multi-start convergence check, NaN guards, non-steady-state sampling labelled "steady-state projection", AUC>600 switched to structured management (no one-line dose reduction)
- Tiered data confidence (v0.3.2, **backed by L2 shrinkage**): steady-state two levels → High, steady-state single level → Moderate, non-steady-state → Low, shown as a badge on the results page
- Clinical declarations (v0.3.2): AKI / unreliable dosing or sampling times / pregnancy / CF (cannot be detected automatically; checking them lowers confidence; in this mode AKI stops dose recommendations)

> **v0.4.1**: The data-confidence badge and clinical declarations now cover **all three modes** (previously Mode 3 only). AKI handling **differs by mode** — Mode 1's empirical start still gives a starting dose (confidence lowered only); Modes 2/3 extrapolate/project from measured levels, which AKI makes unreliable → dose recommendations stopped / extrapolated doses caveated.

> 💧 **Infusion-rate guidance (v0.4.3, consistent across all three modes)**: sources disagree — FDA / some labels say ≤10 mg/min, UpToDate says 10–15 mg/min, and other manufacturer labels and common practice use 1 g/60 min (≈16.7 mg/min). So **recommendation and warning are separated**: the recommended value (10–15 mg/min, or 1 g/60 min) is shown faintly next to the infusion-time field; **the warning fires only above 17 mg/min or below 60 min** — 17 is deliberately above the 16.7 of 1 g/60 min to avoid false alarms on this common, widely accepted practice. **This is purely an administration-safety matter**: AUC = daily dose / CL is unaffected by tInf, so it is a faint hint that doesn't lower confidence or block dose recommendations. Mode 1 doesn't take tInf (peak/trough assume a fixed 1 h infusion); it only states the recommended range and discloses the assumption.

> ⚠️ **Hemodialysis (HD) is experimental / research-use**: the Goti model has only a binary dialysis covariate (CL×0.7, Vc×0.5) and **does not model** dialysis clearance, intradialytic dosing or post-HD redistribution. Bayesian output for HD is **for AUC estimation reference only and produces no specific dose recommendation**; clinicians must judge for themselves.

**Target population**: adults (≥18 years) with normal renal function, obesity (BMI≥30), or renal impairment.
**Limited / not covered**: intermittent HD (research-use, see above); CRRT / SLED / ECMO / children / pregnancy (not modelled or prior not applicable; see in-tool warnings).

### ⚠️ Two key design constraints

1. **Two weights**: vancomycin mg/kg dosing uses **actual body weight (TBW)**; Cockcroft-Gault CrCl uses **AdjBW** (obesity) = IBW + 0.4×(TBW−IBW).
2. **Full two-part AUC** (Mode 2): `AUC_τ = (Cmax+Cmin)/2×t_inf + (Cmax−Cmin)/ke`, not the elimination-phase-only simplification (which underestimates by ~10%; `pk.test.js` shows 9.5%).

## Results Page Information Hierarchy (v0.5.1)

The results page has four layers, so on the first screen the user can answer "on target? / trustworthy? / change to what? / predicted how much? / when to monitor next?":

| Layer | Content | Default |
|---|---|---|
| 1 Clinical summary | Status bar (on target / below target / above target / adjustment not advised / insufficient data) → current assessment → recommendation + prediction → next monitoring → key limitations (≤3) | Always expanded |
| 2 Alternatives | Mode 2 per-interval dose table, custom simulation | Collapsed |
| 3 Advanced PK and model info | CL/Vd/ke/t½, Bayesian η/Vc/Vp, fit diagnostics, formulas, model source | Collapsed |
| 4 Safety and applicability | Full safety messages and disclaimer | Collapsed |

- **Two copy versions**: `複製臨床摘要` (copy clinical summary; default — conclusion / recommendation / prediction / monitoring / cautions only) and `複製完整 PK 報告` (copy full PK report — method, PK parameters, confidence, full safety messages, candidate regimens).
- **Status never relies on color alone**: badges always carry both an icon and text.
- **"Recommendation" and "prediction" have separate labels**, so model predictions aren't read as orders.
- The summary never judges safety on its own: whether a dose recommendation is allowed always reads `safety.allowDoseRecommendation`; AUC interpretation takes safety's `AUC_OK/LOW/HIGH` message codes; structured management for AUC>600 comes straight from `SAFETY.auc600Management()`.
- **On BLOCK** (AKI / HD / AUC>600 / unreliable sampling times / Bayesian fit failure / pediatric / CRRT) the summary and short clinical version **contain no specific new dose**, listing the cause and next step instead; the measured AUC and current regimen are shown as usual. Mode 2's interval dose table is relabelled "extrapolated reference (not directly applicable to this case)".
- **On WARNING there is a single caveat next to the recommendation**: the highest-ranked item sits right beside it (`recommendation.caveat`) and is then not repeated under "key limitations" — the same sentence twice on one screen just makes people skip the whole area.
- **Layer 2 has its own copy button**: `複製替代方案` (copy alternatives) / on BLOCK renamed `複製外推參考（不可直接採用）` (copy extrapolated reference — not directly applicable). Content: "current state → gate cause → dose–exposure comparison for each interval and custom simulation → next step → not-an-order statement". **Extrapolated rows always use the on-screen format `750 mg q12h`, never the chart format `Vancomycin 750 mg IV q12h`** — this section can still be copied when the gate is closed, so it must not look like a paste-ready order; only the "current state" line uses the chart format (the regimen the patient is already on). The default copy button remains the short clinical version, which contains no extrapolated doses.
- **Custom simulation (what-if)**: on BLOCK, `複製臨床摘要` only keeps "a custom simulation was run but not included because of a safety gate" and the cause, **with no dose, interval or predicted exposure**; `複製完整 PK 報告` keeps the numbers for review, marked as unreliable. The versioning rules live in `SUMMARY.customSimulationNote()`; the UI must not assemble them itself.
- **No blank first screen on calculation failure**: invalid input, two-level back-calculation failure and Bayesian non-convergence all go through `SUMMARY.buildFatalSummary()`, listing the reason and a clear next step in layer 1 (layer 4's `<details>` is collapsed by default, so writing it only there would show nothing).
- **Fail-closed safety boundary**: if `buildClinicalSummary()` doesn't receive a complete verdict (missing `allowCalculation` / `allowDoseRecommendation`), it always treats the case as not computable and gives no dose recommendation.
- ⚠️ **Unreliable sampling times now block dose recommendations (semantic change in v0.5.0)**: the AUC estimate itself rests on the sampling times; if they can't be trusted, new doses extrapolated from that AUC can't be either. Previously this only lowered confidence to Moderate.

## Future Work (not started)

- ~~Crass 2018 obesity CLV~~ (added as a Mode 1 CL model option in v0.4.0)
- CRRT / continuous infusion (CI)
- Advanced mode with a full event list for dosing history (currently regular regimens)
- L4 external clinical comparison (awaiting real rich-sampling / commercial Bayesian data; see `docs/bayes-validation.md`)

## Architecture

```
vanco-auc-calc/
├── index.html          # Single page, three tabs (includes PWA manifest/SW registration)
├── manifest.webmanifest # PWA install info (name/icons/theme color)
├── sw.js               # Service worker (caches app shell, offline-capable)
├── icons/              # PWA icons (192/512/maskable-512/apple-touch)
├── js/
│   ├── constants.js    # Clinical constants (VANCO / CG / GOTI, centrally managed)
│   ├── pk.js           # One-compartment PK pure functions (Mode 1/2)
│   ├── pk.test.js      # sanity tests (28/28; includes Crass obesity CL)
│   ├── bayes.js            # Two-compartment Bayesian MAP engine (Mode 3; convergence/multi-start/NaN guards)
│   ├── bayes.test.js       # sanity tests (31/31)
│   ├── bayes.validation.js # L1 analytical oracle + L2 simulation-estimation (rerunnable)
│   ├── bayes.golden.test.js# golden-master regression baseline (21/21)
│   ├── safety.js           # Deterministic safety layer (eligibility / level guards / fit guards / AUC grading)
│   ├── safety.test.js      # Safety behavior C-cases (51/51)
│   ├── summary.js          # Clinical summary assembly (pure functions: summary / short clinical Plan / full technical version)
│   ├── summary.test.js     # Summary layering behavior S-cases (83/83)
│   ├── viewmodel.js        # Flattening PK results → summary contract (pure functions, one per mode)
│   ├── viewmodel.test.js   # Flattening correctness V-cases (34/34; real PK/BAYES outputs as input)
│   └── ui.js               # DOM binding and rendering
└── css/style.css           # Noto Sans TC + DM Mono, BEM
```

Tech: plain HTML/CSS/JS, no framework (same as bicarb-dosing-calc).

## Tests

```bash
node js/pk.test.js           # Mode 1/2 (one-compartment, Sawchuk-Zaske, Crass obesity)    28/28
node js/bayes.test.js        # Mode 3 (convergence flags, NaN guards, steady-state AUC)     31/31
node js/safety.test.js       # Safety-layer behavior (BLOCK/WARNING triggering, infusion rate) 51/51
node js/summary.test.js      # Clinical summary layering (interpretation/gates/two text versions/format/edges) 83/83
node js/viewmodel.test.js    # Flattening PK results → summary contract (three modes)       34/34
node js/bayes.golden.test.js # golden-master regression baseline                             21/21
node js/bayes.validation.js  # L1 analytical oracle (hard gate) + L2 simulation-estimation (N=1000)
```

> ⚠️ Most `*.test.js` files are **verification (self-consistency)**. Real Mode 3 **validation** is `bayes.validation.js`: L1 cross-checks RK4 against an **independent analytical solution** (breaking the round-trip circularity), and L2 measures bias/precision/shrinkage by simulation-estimation. See `docs/bayes-validation.md`.

## Validation Status

| Scope | Status |
|---|---|
| Mode 1/2 numerics | Limited mathematical verification + cross-check against selected ClinCalc cases (see `docs/validation.md`) |
| Mode 3 engine | **L1 independent analytical oracle: PASS** (RK4 vs closed form <1e-6); **L2 simulation-estimation: done** (N=1000; estimator unbiased if Goti is true). See `docs/bayes-validation.md` |
| External Bayesian comparison | Commercial tools / rich-sampling AUC: **not done** |
| Prospective clinical validation | **Not done** |

## References

Clinical guidelines and models:

- Rybak, M. J., Le, J., Lodise, T. P., Levine, D. P., Bradley, J. S., Liu, C., Mueller, B. A., Pai, M. P., Wong-Beringer, A., Rotschafer, J. C., Rodvold, K. A., Maples, H. D., & Lomaestro, B. M. (2020). Therapeutic monitoring of vancomycin for serious methicillin-resistant *Staphylococcus aureus* infections: A revised consensus guideline and review by the American Society of Health-System Pharmacists, the Infectious Diseases Society of America, the Pediatric Infectious Diseases Society, and the Society of Infectious Diseases Pharmacists. *American Journal of Health-System Pharmacy, 77*(11), 835–864. https://doi.org/10.1093/ajhp/zxaa036

- Goti, V., Chaturvedula, A., Fossler, M. J., Mok, S., & Jacob, J. T. (2018). Hospitalized patients with and without hemodialysis have markedly different vancomycin pharmacokinetics: A population pharmacokinetic model-based analysis. *Therapeutic Drug Monitoring, 40*(2), 212–221. https://doi.org/10.1097/FTD.0000000000000459

- Crass, R. L., Dunn, R., Hong, J., Krop, L. C., & Pai, M. P. (2018). Dosing vancomycin in the super obese: Less is more. *Journal of Antimicrobial Chemotherapy, 73*(11), 3081–3086. https://doi.org/10.1093/jac/dky310

- Chen, A., Gupta, A., Do, D. H., & Nazer, L. H. (2022). Bayesian method application: Integrating mathematical modeling into clinical pharmacy through vancomycin therapeutic monitoring. *Pharmacology Research & Perspectives, 10*(6), e01026. https://doi.org/10.1002/prp2.1026

- Broeker, A., Nardecchia, M., Klinker, K. P., Derendorf, H., Day, R. O., Marriott, D. J., Carland, J. E., Stocker, S. L., & Wicha, S. G. (2019). Towards precision dosing of vancomycin: A systematic evaluation of pharmacometric models for Bayesian forecasting. *Clinical Microbiology and Infection, 25*(10), 1286.e1–1286.e7. https://doi.org/10.1016/j.cmi.2019.02.029

Calculation methods (PK/statistics):

- Sawchuk, R. J., & Zaske, D. E. (1976). Pharmacokinetics of dosing regimens which utilize multiple intravenous infusions: Gentamicin in burn patients. *Journal of Pharmacokinetics and Biopharmaceutics, 4*(2), 183–195. https://doi.org/10.1007/BF01086153

- Matzke, G. R., McGory, R. W., Halstenson, C. E., & Keane, W. F. (1984). Pharmacokinetics of vancomycin in patients with various degrees of renal function. *Antimicrobial Agents and Chemotherapy, 25*(4), 433–437. https://doi.org/10.1128/AAC.25.4.433

- Sheiner, L. B., Beal, S., Rosenberg, B., & Marathe, V. V. (1979). Forecasting individual pharmacokinetics. *Clinical Pharmacology & Therapeutics, 26*(3), 294–305. https://doi.org/10.1002/cpt1979263294

Infusion rate (sources disagree; this tool uses "recommend 10–15 mg/min, warn above 17 mg/min"; reasons in `js/constants.js`):

- Vancomycin label (FDA prescribing information): ≤10 mg/min or infused over at least 60 minutes.
- UpToDate / Lexicomp drug monograph: 10–15 mg/min recommended.
- Some manufacturer labels and common clinical practice: 1 g / 60 min (≈16.7 mg/min).

## License

MIT License (see `LICENSE`). Clinical content is for education and decision support only.
