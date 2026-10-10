# Phase 08 — The audience model

**Goal.** Fit a per-channel, per-audience discrete-time hazard model with real uncertainty, store it as a portable JSON artifact, and predict with it from TypeScript. Fitting is the one place this project uses Python. This phase is the product's core claim.

**Depends on.** Phase 07. Days: Oct 7 to 8.

## Stack

- **Python (`services/modeling`):** numpy, scipy (`scipy.optimize.minimize`, L-BFGS-B), `google-cloud-bigquery` with `db-dtypes`, `google-cloud-storage`, `google-cloud-aiplatform` (Vertex AI Experiments), `jsonschema`, Typer
- **TypeScript (`packages/core/src/model`):** prediction runtime on `Float64Array`; `ml-matrix` for the Cholesky factorization; a small seeded PRNG (xoshiro128\*\* or `pure-rand`) with Box–Muller for normal draws
- **Contract:** `packages/core/src/schemas/model-artifact.ts` in zod; a Turborepo task `gen:schemas` exports it with `z.toJSONSchema` to `services/modeling/schemas/model-artifact.schema.json`

## Why this model

A fractional-response logistic regression on binned hazards is a discrete-time survival model fitted to aggregated data. It produces coefficients with a covariance matrix, which gives honest uncertainty bands, and the artifact is a few kilobytes of JSON, so a Next.js route handler can predict in milliseconds. Fitting is custom because statsmodels' regularized fit does not return a covariance, and BigQuery ML's logistic regression needs binary labels.

For video v, audience a and bin b, with hazard h and the full Phase 07 feature vector x (which already contains the spline basis, mix shares and interaction columns):

```latex
\operatorname{logit} h_{vab} = \alpha_a + \beta_a^{\top} \tilde{x}_{vb}
```

Here x-tilde is x standardized with means and standard deviations stored in the artifact. The model is linear in x, which is what makes the TypeScript runtime trivial and the parity test exact.

## Build

1. **Python fitter**, `soundcheck_modeling/fit.py`: read `training_bins` and `feature_specs` for a channel, audience and feature version. Maximize the weighted fractional log-likelihood, sum of `w * (h * log p + (1 - h) * log(1 - p))`, minus `0.5 * lambda * ||beta - beta0||^2`. The intercept and the spline columns `pos_b*` are not penalized. Supply the analytic gradient.
2. **Covariance** by Laplace approximation: the inverse of `X^T W X + lambda * P`, with W holding `w * p * (1 - p)` and P the penalty mask. Analytic, not numerical.
3. **Weights:** within a video, proportional to `n_at_risk`; across videos, scaled so each video's total weight is proportional to `log(1 + views)`, so one viral video cannot dominate. Document the choice.
4. **Prior (empirical-Bayes shrinkage):** first fit a pooled model across all usable channels with a small lambda; its coefficients become `beta0` for each channel. Thin channels lean on the pool; rich channels learn their own physics. With a single channel, `beta0` is zero.
5. **Lambda** per channel by 5-fold cross-validation grouped by video over 0.1, 1, 3, 10, 30, 100.
6. **Starting content features** (about 20, chosen for strength, not completeness): sponsor share, intro\_branding share, cta share, tangent share, talking\_head\_static share, `log1p(static_run_s)`, `log1p(cuts_per_min)`, on\_screen\_text share, energy, info\_density, knowledge\_gap, `open_loops > 0`, before\_payoff, `log1p(secs_in_current_beat)`, speech\_wpm, music\_fg share, b\_roll share, screen\_recording share, recap share, payoff share. The 6 interacted with traffic mix (Phase 07): sponsor share, intro\_branding share, knowledge\_gap, `log1p(static_run_s)`, info\_density, before\_payoff. If a column set changes, Phase 07's spec and `FEATURE_VERSION` change with it.
7. **Artifact:** `{channelId, audience, featureVersion, modelVersion, featureNames, mean, sd, alpha, beta, cov, lambda, priorRef, trainVideoIds, metrics}`, validated against the exported JSON Schema before writing to `gs://{project}-raw/{channel}/models/{runId}/{audience}.json`, with a `model_runs` row.
8. **Experiments:** log lambda, row counts, training loss and convergence to Vertex AI Experiments (`aiplatform.init(experiment="soundcheck-models")`).
9. **TypeScript runtime**, `packages/core/src/model/runtime.ts`: `loadArtifact` (zod-validated), `predictHazard(artifact, frame)`, `survival(hazard)`, and `sampleCurves(artifact, frame, n = 200, seed)`, which draws coefficient vectors as beta plus L times z (L the Cholesky factor of the covariance, z standard normals) and returns 10th, 50th and 90th percentile survival curves.
10. **Traits**, `packages/core/src/model/effects.ts`: turn the model into readable statements by simulation, not by reading coefficients. Take a typical video's frame, switch a feature on for a realistic span (for example, 30 seconds of sponsor at 30% elapsed) by editing beats and re-running the featurizer, and report the change in percentage points still watching with an interval from the samples: `{feature, condition, deltaPp, ciLow, ciHigh}`.
11. **Estimated audiences:** evaluate the newcomer model with the mix set fully to search, suggested or browse. Show one only if its share has a standard deviation of at least 0.08 across at least 30 training videos and at least one trait's interval excludes zero.
12. **CLI:** `uv run soundcheck-modeling fit-pooled` and `uv run soundcheck-modeling fit --channel UC... --audience all|subscribed|unsubscribed`.
13. **Tests:**
    - Python: a synthetic generator with known coefficients that the fitter must recover within tolerance (the most important test in the repo); analytic gradient and Hessian against finite differences; artifact validates against the schema.
    - Cross-language parity: Python writes `tests/fixtures/parity/` (an artifact, a feature frame and its expected hazards); a Vitest test loads them and the TypeScript runtime must match within 1e-9.
    - TypeScript: Cholesky sampling reproduces the covariance within tolerance on 20,000 draws; seeded sampling is deterministic.

## Decisions and gotchas

- This is correlational. User-facing text says "associated with" and "in your past videos", never "causes".
- If the fitter does not converge for an audience, record it and skip that audience. Never ship a non-converged model.
- BigQuery stays the warehouse; it does not do the fitting.

## Do not

- Add features after seeing held-out results (Phase 09) without bumping `FEATURE_VERSION` and re-running the evaluation from scratch.
- Re-implement featurization in Python to "check" something. Use the parity fixtures.

## Done when

- [ ] Synthetic recovery test and the cross-language parity test pass
- [ ] Pooled and per-channel models trained for every usable channel and audience
- [ ] Runs visible in Vertex AI Experiments
- [ ] The traits list for one channel pasted into the notes, with a sanity read from the team
- [ ] `docs/notes/phase-08.md` written
