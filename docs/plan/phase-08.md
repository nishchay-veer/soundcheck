# Phase 08 — The audience model

**Goal.** Fit a per-channel, per-audience discrete-time hazard model with real uncertainty, store it as a portable JSON artifact, and predict with it from TypeScript. Fitting is the one place this project uses Python. This phase is the product's core claim.

**Depends on.** Phase 07. Days: Oct 7 to 8.

## Stack

- **Python (`services/modeling`):** numpy, scipy (`scipy.optimize.minimize`, L-BFGS-B), `google-cloud-bigquery`, `google-cloud-storage`, `google-cloud-aiplatform` (Vertex AI Experiments), `jsonschema`, Typer. `db-dtypes` is not needed: nothing uses pandas.
- **TypeScript (`packages/core/src/model`):** prediction runtime on `Float64Array`; `ml-matrix` for the Cholesky factorization; a small seeded PRNG (xoshiro128\*\*, seeded through splitmix32) with Box–Muller for normal draws
- **Contract:** `packages/core/src/schemas/model-artifact.ts` in zod; a Turborepo task `gen:schemas` (`pnpm gen:schemas`) exports it with `z.toJSONSchema` to `services/modeling/schemas/model-artifact.schema.json`, together with the `model_runs` row schema and `model-config.json` (the model's columns and settings, from `packages/core/src/model/config.ts`). A test fails when the exported files are stale.

## Why this model

A fractional-response logistic regression on binned hazards is a discrete-time survival model fitted to aggregated data. It produces coefficients with a covariance matrix, which gives honest uncertainty bands, and the artifact is tens of kilobytes of JSON (13 KB at 20 columns, 36 KB at 35; the covariance is most of it), so a Next.js route handler can predict in milliseconds. Fitting is custom because statsmodels' regularized fit does not return a covariance, and BigQuery ML's logistic regression needs binary labels.

For video v, audience a and bin b, with hazard h and the model's columns x of the Phase 07 feature vector (the spline basis, mix shares and interaction columns among them):

```latex
\operatorname{logit} h_{vab} = \alpha_a + \beta_a^{\top} \tilde{x}_{vb}
```

Here x-tilde is x standardized with means and standard deviations stored in the artifact. The model is linear in x, which is what makes the TypeScript runtime trivial and the parity test exact.

## Build

1. **Python fitter**, `soundcheck_modeling/fit.py`: read `training_bins` and `feature_specs` for a channel, audience and feature version, and the model's columns from `model-config.json`:
   - all viewers and subscribers: position (`is_first_bin`, `log_bin_seconds`, `pos_b1`–`pos_b6`) plus the 20 starting content features, 28 columns;
   - newcomers: those plus the 3 mix shares and the 18 interactions, 49 columns.

   Video-level columns (format, target level) are not used. Columns that never vary in the training rows are dropped and listed in the artifact. Maximize the weighted fractional log-likelihood, sum of `w * (h * log p + (1 - h) * log(1 - p))`, minus `0.5 * lambda * ||beta - beta0||^2`. The intercept and the spline columns `pos_b*` are not penalized. Supply the analytic gradient. After L-BFGS-B, Newton steps reach the optimum to machine precision (the problem is convex). A fit has converged when its largest gradient component is below 1e-7 times the total weight and its Hessian is positive definite.

2. **Covariance** by Laplace approximation: the inverse of `X^T W X + lambda * P`, with W holding `w * p * (1 - p)` and P the penalty mask, **scaled by the quasi-likelihood dispersion**: the weighted Pearson scatter, sum of `w * (h - p)^2 / (p * (1 - p))`, divided by the rows minus the effective number of parameters, `trace((X^T W X + lambda * P)^-1 X^T W X)`. Analytic, not numerical. The weights below fix how much rows and videos count relative to each other, not how many observations they are, so the dispersion sets their scale and the covariance does not depend on it. Without it the covariance was about 140 times too wide (`hazard-v1`).
3. **Weights:** within a video, proportional to `n_at_risk`; across videos, scaled so each video's total weight is `log(1 + views)` (the audience's views), so one viral video cannot dominate. A video with nobody at risk gets no weight.
4. **Prior (empirical-Bayes shrinkage):**
   - First fit a pooled model across all usable channels with lambda 0.1. Its coefficients, converted to raw units (beta / sd) and then into each channel's standardization, become `beta0` for each channel. Thin channels lean on the pool; rich channels learn their own physics.
   - The pooled model is usable as a prior only when it covers at least 2 channels. Otherwise (and with a single channel) `beta0` is zero.
5. **Lambda** per channel by cross-validation grouped by video over 0.1, 1, 3, 10, 30, 100. There are `min(5, videos)` folds, and folds hold out whole videos. The score is the held-out weighted mean negative log-likelihood; ties go to the larger lambda. Without 2 videos there is nothing to hold out, and lambda is 10.
6. **Starting content features** (about 20, chosen for strength, not completeness; column names from Phase 07):
   - **Beat types:** `beat_sponsor`, `beat_intro_branding`, `beat_cta`, `beat_tangent`, `beat_recap`, `beat_payoff`.
   - **Picture:** `static_talking_head_share` (the plan's former "talking_head_static share"), `log1p_static_run_s`, `log1p_cuts_per_min`, `on_screen_text`, `visual_b_roll`, `visual_screen_recording`.
   - **Delivery and audio:** `energy`, `info_density`, `speech_wpm`, `music_fg`.
   - **Narrative and pacing:** `knowledge_gap`, `has_open_loop` (`open_loops > 0`), `before_payoff`, `log1p_secs_in_current_beat`.

   The 6 interacted with traffic mix (Phase 07): `beat_sponsor`, `beat_intro_branding`, `knowledge_gap`, `log1p_static_run_s`, `info_density`, `before_payoff`. If a column set changes, Phase 07's spec and `FEATURE_VERSION` change with it; changing the model's columns or settings bumps `MODEL_VERSION`.

7. **Artifact:**
   - **Fields:** `{runId, channelId, audience, modelVersion, featureVersion, extractionVersion, createdAt, featureNames, droppedFeatures, unpenalized, mean, sd, alpha, beta, cov, lambda, priorRef, trainChannelIds, trainVideoIds, channelContext, usable, unusableReasons, metrics}`.
   - **`cov`** covers (alpha, beta), intercept first.
   - **`channelContext`** is copied from the `feature_contexts` table that `soundcheck features` writes, so predictions measure features the same way.
   - **`usable` is false**, with reasons, for a channel model trained on fewer than `MIN_TRAIN_VIDEOS` (30) videos, or for a pooled model from one channel. Such a model is never shown or shipped.
   - **`metrics`:** rows, videos, training loss, the cross-validation losses, folds, iterations, convergence, gradient norm, dispersion and effective parameters.
   - **Where it goes:** it is validated against the exported JSON Schema (plus the consistency checks the schema cannot express) before it is written to `gs://{project}-raw/{channel}/models/{runId}/{audience}.json` (`pooled/models/…` for the pooled model).
   - **`model_runs`:** each fit writes a row, keyed by audience. The status is `fitted`, `not_converged` (no artifact written), `no_data` or `failed`.
8. **Experiments:** log lambda, row counts, training loss, dispersion and convergence to Vertex AI Experiments, `aiplatform.init(experiment="soundcheck-models", experiment_tensorboard=False)`, so no billed TensorBoard is created. A logging failure is recorded on the `model_runs` row; it does not lose the fit.
9. **TypeScript runtime**, `packages/core/src/model/runtime.ts`:
   - `loadArtifact` (zod-validated), `predictHazard(artifact, frame)` and `survival(hazard)`;
   - `drawCoefficients(artifact, n, seed)`: beta plus L times z, with L the Cholesky factor of the covariance and z standard normals;
   - `sampleCurves(artifact, frame, n = 200, seed)`, which returns 10th, 50th and 90th percentile survival curves.
10. **Traits**, `packages/core/src/model/effects.ts`: turn the model into readable statements by simulation, not by reading coefficients.
    - **The video:** take a typical video's frame. `soundcheck traits --channel UC…` uses the training video of median length.
    - **The edits:** one of 19 scenarios, one per starting content feature, switches a feature on for a realistic span (for example, 30 seconds of sponsor at 30% elapsed) by editing beats (`overlay` splits them at the span's edges) and re-running the featurizer.
    - **The report:** the change in percentage points still watching at the end of the video, with a 90% interval (5th to 95th percentile) from coefficient draws applied to both the original and the edited video: `{feature, condition, measured, deltaPp, ciLow, ciHigh}`.
    - **Unlearned features:** a scenario whose columns never varied in training is reported as not learned, with no number.
11. **Estimated audiences:** evaluate the newcomer model with the mix set fully to search, suggested or browse. Show one only if its share has a standard deviation of at least 0.08 across at least 30 training videos (the artifact's `sd` of `mix_<source>` and `trainVideoIds`) and at least one trait's interval excludes zero. Otherwise it is hidden, with the reasons.
12. **CLI:** `uv run soundcheck-modeling fit-pooled [--audience …]` and `uv run soundcheck-modeling fit --channel UC... [--audience all|subscribed|unsubscribed]` (all three by default); locally with `--env-file ../../.env`.
13. **Tests:**
    - Python: a synthetic generator with known coefficients that the fitter must recover within tolerance (the most important test in the repo). With the production weights, the coefficient spread across 40 synthetic datasets matches the covariance. Analytic gradient and Hessian against finite differences; the covariance does not depend on the weights' scale; artifacts and rows validate against the schemas.
    - Cross-language parity: `tests/fixtures/parity/`. `scripts/parity-frame.ts` writes a TypeScript-built feature frame; `services/modeling/scripts/parity_fixture.py` fits a model and writes the artifact and the hazards the fitter predicts for that frame. A Vitest test loads them, and the TypeScript runtime must match within 1e-9.
    - TypeScript: Cholesky sampling reproduces the covariance within tolerance on 20,000 draws; seeded sampling is deterministic; the PRNG matches xoshiro128\*\*'s reference outputs.

## Decisions and gotchas

- This is correlational. User-facing text says "associated with" and "in your past videos", never "causes".
- If the fitter does not converge for an audience, record it and skip that audience. Never ship a non-converged model, or one marked not usable.
- BigQuery stays the warehouse; it does not do the fitting.
- The dispersion treats bins as independent. Bins of one video are not, so bands may be too narrow; Phase 09's held-out calibration checks this, and a per-video robust (sandwich) covariance is the next step if they are.
- A trait's condition is relative to the typical video: "the payoff at 25%" is later than now for a video whose payoff is at 10 s.

## Do not

- Add features after seeing held-out results (Phase 09) without bumping `FEATURE_VERSION` and re-running the evaluation from scratch.
- Re-implement featurization in Python to "check" something. Use the parity fixtures.

## Done when

- [ ] Synthetic recovery test and the cross-language parity test pass
- [ ] Pooled and per-channel models trained for every usable channel and audience
- [ ] Runs visible in Vertex AI Experiments
- [ ] The traits list for one channel pasted into the notes, with a sanity read from the team
- [ ] `docs/notes/phase-08.md` written
