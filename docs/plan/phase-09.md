# Phase 09 — Evaluation and baselines

**Goal.** The headline number: an honest, held-out comparison of the audience model against two baselines and an ablation, plus a check that the uncertainty bands mean what they claim. The output is a model card.

**Depends on.** Phase 08. Day: Oct 9. Model gate: Oct 10.

## Stack

- **Python (`services/modeling`):** numpy, scipy, matplotlib, Jinja2 for the model card template, Vertex AI Experiments for metrics; predictions use the same linear form as the TypeScript runtime (covered by the parity test)
- **TypeScript:** `apps/pipeline/src/commands/baseline-llm.ts` produces the generic-LLM baseline, so every Gemini call stays in TypeScript

## Build

1. Split per channel by time: the most recent 20% of eligible videos (at least 6) are the test set; exclude videos under 14 days old, whose curves are still settling. Refit Phase 08 on the training videos only.
2. Metrics per test video and audience:
   - **Curve MAE:** mean absolute difference between predicted and actual survival over bins 2 to 100, in percentage points.
   - **Average-view-percentage error:** absolute difference between the mean predicted survival and the actual average view percentage.
   - **Drop hit rate:** whether the model's top 3 predicted hazard spikes fall within ±3 bins of the actual top 3.
   - **Ranking:** Spearman correlation between predicted and actual average view percentage across test videos. This answers "can it tell which of two videos will hold attention better?"
3. Baselines:
   - **B0, channel average:** the mean training survival curve. Also a duration-matched version using the 10 training videos nearest in length. Report whichever is stronger.
   - **B1, generic LLM:** Gemini sees the same video and its duration and predicts a 20-point retention curve for a typical YouTube audience, with no channel data; interpolate to 100 points. This stands in for every rubric-based competitor. The TypeScript baseline-llm command writes these curves to a baseline\_llm\_curves table; Python reads them.
   - **B2, ablation:** the model with content features removed (position and duration terms only). If B2 matches the full model, the content features add nothing and you must say so.
4. Interval calibration: the share of actual points inside the predicted 80% band, target 70% to 90%. If far outside, fit one scalar inflation of the covariance on a validation fold and document it.
5. Significance: paired bootstrap over test videos (2,000 resamples) for the MAE difference between the model and B0. Claim "beats baseline" only if the 95% interval excludes zero.
6. Persist an `eval_runs` row, log metrics to Vertex AI Experiments, and generate `docs/model-card.md` from a template: data, features, method, metrics table, calibration, limitations (correlational, small samples, estimated audiences, the Aug 2026 view-counting change).
7. `soundcheck_modeling/plots.py`: one PNG per test video with predicted band, median and actual curve. These are your demo slides.

## Decisions and gotchas

- The channel average is a strong baseline because most retention curves look alike. Beating it by even 1 percentage point of MAE, with a significant interval, is a real result. Say exactly that.
- Never tune anything on the test set. If you change the model after looking, refit and evaluate on a new split, and say so on the card.

## Do not

- Build any UI before this phase produces a real number. That is the model gate.

## Done when

- [ ] Model card exists with real numbers for every usable channel and audience
- [ ] Bootstrap interval reported for model versus B0
- [ ] Calibration reported
- [ ] Evaluation plots generated
- [ ] Model gate decision recorded in the notes: pass, or what you will change on Oct 10
- [ ] `docs/notes/phase-09.md` written
