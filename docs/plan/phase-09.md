# Phase 09 — Evaluation and baselines

**Goal.** The headline number: an honest, held-out comparison of the audience model against two baselines and an ablation, plus a check that the uncertainty bands mean what they claim. The output is a model card.

**Depends on.** Phase 08. Day: Oct 9. Model gate: Oct 10.

## Stack

- **Python (`services/modeling`):** numpy, scipy, matplotlib, Jinja2 for the model card template, Vertex AI Experiments for metrics. Predictions use the fitter's linear form, which the parity test ties to the TypeScript runtime.
- **TypeScript:** `apps/pipeline/src/commands/baseline-llm/` produces the generic-LLM baseline, so every Gemini call stays in TypeScript.

## Build

1. **Split per channel by time:**
   - **Test set:** the most recent 20% of eligible videos (at least 6), excluding videos under 14 days old (counted to the curves' data date), whose curves are still settling.
   - **Refit:** Phase 08 is refitted on the training videos only, with lambda chosen by cross-validation on them. The pooled prior is refitted without the test videos and used only when 2 or more channels remain.
   - **The split's numbers** live in `packages/core/src/model/config.ts` (`EVALUATION_SPLIT`) and are exported to Python. TypeScript's `evaluationTestVideos` and Python's `choose_split` apply the same rule, so the LLM baseline is asked about the test videos.
   - **Check mode:** a channel that cannot hold out 6 videos and still keep `MIN_TRAIN_VIDEOS` (30) for training holds each video out in turn instead. The result is labelled a pipeline check everywhere (eval status `check`, plots, card) and never makes a claim.
2. **Metrics per test video and audience:**
   - **Curve MAE:** mean absolute difference between predicted and actual survival over bins 2 to 100, in percentage points. The actual curve is rebuilt from the hazards the model trains on.
   - **Share-watched error:** absolute difference between the mean predicted survival and the mean actual survival. YouTube's average view percentage counts rewatches, can pass 100%, and has no all-viewers figure, so it is shown beside the result for reference and never scored against.
   - **Drop hit rate:** the share of the model's top 3 predicted hazard spikes that fall within ±3 bins of an actual top-3 spike. Spikes are the highest-hazard bins among bins 2 to 100 (bin 1 is always the largest), at least 4 bins apart.
   - **Ranking:** Spearman correlation between predicted and actual mean survival across test videos (at least 3). This answers "can it tell which of two videos will hold attention better?"
3. **Baselines:**
   - **B0, channel average:** the mean training survival curve. Also a duration-matched version using the 10 training videos nearest in length. Report whichever is stronger on the test videos; choosing it that way favours the baseline, and the card says so.
   - **B1, generic LLM:** Gemini sees the same video and its duration, and predicts a 20-point retention curve for a typical YouTube audience with no channel data (prompt `llm-retention-v1`). The points are made non-increasing and interpolated to 100. This stands in for every rubric-based competitor.
     - `soundcheck baseline-llm --channel UC… [--video] [--no-cache]` writes these curves to a `baseline_llm_curves` table; Python reads the latest per video.
     - Answers are archived raw, retried once if invalid, and cached by prompt version, model and video mode.
   - **B2, ablation:** the model with content features removed (position and duration terms only). If B2 matches the full model, the content features add nothing and you must say so.
4. **Interval calibration:**
   - **Target:** the share of actual points inside the predicted 80% band (from 200 coefficient draws), 70% to 90%.
   - **The check:** made on validation videos, the newest 20% of the training videos predicted by a model fitted on the rest, never on the test set.
   - **If the validation coverage is outside the target,** fit one scalar inflation of the covariance on them (bisection on its logarithm) and draw the test bands again with it. Document the factor, the validation coverage and the test coverage.
   - **Expect inflation.** The band describes uncertainty about the expected curve, while each real curve also has its own noise, so on synthetic data even a correct model's raw band covered only 15%.
   - **Holdout mode only.**
5. **Significance:** paired bootstrap over test videos (2,000 resamples) for the MAE difference between the model and B0. Claim "beats baseline" only if the 95% interval excludes zero (it is entirely below zero).
6. **Persist and report:**
   - **Command:** `uv run soundcheck-modeling evaluate --channel UC… [--audience …]`.
   - **Records:**
     - the full evaluation as JSON in `{channel}/evals/{run}/evaluation.json`;
     - an `eval_runs` row validated against the exported schema: status `holdout`, `check` or `failed`, and `model_run_id` the production run it vouches for;
     - one Vertex AI Experiments run per audience (`eval-…`).
   - **Evaluation models are never written to `model_runs`,** so nothing publishes them.
   - **The card:** `uv run soundcheck-modeling model-card` generates `docs/model-card.md` from a Jinja2 template, covering data, features, method, metrics table, calibration, and limitations (correlational, small samples, estimated audiences, the Aug 2026 view-counting change, the baselines' caveats). Without a held-out result it opens with "No result yet".
7. `soundcheck_modeling/plots.py`: one PNG per test video in `docs/eval/{channel}/`, a panel per audience, with predicted band, median, actual curve, B0 and B1. These are your demo slides.

## Decisions and gotchas

- The channel average is a strong baseline because most retention curves look alike. Beating it by even 1 percentage point of MAE, with a significant interval, is a real result. Say exactly that.
- Never tune anything on the test set. If you change the model after looking, refit and evaluate on a new split, and say so on the card.
- With 2 training videos (check mode on a 3-video channel), the length column only tells videos apart: predictions for a video of a new length collapse. Check-mode numbers say nothing about the model.

## Do not

- Build any UI before this phase produces a real number. That is the model gate.

## Done when

- [ ] Model card exists with real numbers for every usable channel and audience
- [ ] Bootstrap interval reported for model versus B0
- [ ] Calibration reported
- [ ] Evaluation plots generated
- [ ] Model gate decision recorded in the notes: pass, or what you will change on Oct 10
- [ ] `docs/notes/phase-09.md` written
