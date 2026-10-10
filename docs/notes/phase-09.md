# Phase 09: Evaluation and baselines

Oct 10, 2026

Soundcheck can now evaluate its audience model honestly:

- it holds out each channel's newest videos;
- it scores the model against the channel average (B0), Gemini's generic guess (B1) and itself without content features (B2);
- it checks whether the uncertainty bands cover what they claim;
- it tests the difference from B0 with a bootstrap;
- it writes a model card and demo plots.

On the test channel it ran in check mode, because 3 videos are too few to hold any out. Every step works end to end, and **the model gate is not passed: there is no result yet.**

**Built in four reviewed commits:**

1. `Split, score and compare models in Python`
2. `Add the generic-LLM baseline`
3. `Record evaluations and write the model card`
4. `Verify Phase 09 and write the notes`

## Done when

| Item                                                                      | Status                         | Evidence                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model card exists with real numbers for every usable channel and audience | **Not met: no usable channel** | `docs/model-card.md` exists and covers all three audiences. It opens with "No result yet", because the only channel runs in check mode. It refreshes with `soundcheck-modeling model-card` once a channel has enough videos |
| Bootstrap interval reported for model versus B0                           | Done (check mode)              | In the card for every audience, e.g. all viewers −3.1 pp (−10.2 to +7.1), with the verdict "no claim (check mode)"                                                                                                          |
| Calibration reported                                                      | Done (check mode)              | 80% band coverage: 61% all viewers, 10% subscribers, 40% newcomers. Inflation is only fitted in holdout mode                                                                                                                |
| Evaluation plots generated                                                | Done                           | `docs/eval/UC-BHlgFbFh3V76yth-XCmlw/`: one PNG per video, titled "pipeline check, not a result"                                                                                                                             |
| Model gate decision recorded in the notes                                 | Done                           | **Not passed**; see "Model gate"                                                                                                                                                                                            |
| `docs/notes/phase-09.md` written                                          | Done                           | This file                                                                                                                                                                                                                   |

**Also verified:**

- **`eval_runs`** has one row: status `check`, vouching for the production run `ccf38c5d`. The full evaluation is in `gs://soundcheck-510519-raw/UC-BHlgFbFh3V76yth-XCmlw/evals/79c376c5…/evaluation.json`.
- **Experiments:** 3 `eval-…` runs in Vertex AI Experiments.
- **`pnpm check`** passes all 20 tasks: core 477 tests, pipeline 136, modeling 53.

## Live run

All on Oct 10, 2026, for the channel `UC-BHlgFbFh3V76yth-XCmlw`.

1. **`soundcheck baseline-llm --channel …`:** Gemini guessed a curve for each of the 3 videos (check mode asks about all of them). It took 3.5 minutes and cost **$0.047**. No answer needed repair.
2. **`soundcheck-modeling evaluate --channel …`:** check mode, "3 settled videos: a held-out test needs 6 test videos and 30 training videos". Each video was predicted by models fitted on the other two. It took 59 seconds.
3. **`soundcheck-modeling model-card`.**

Curve error in percentage points, averaged over the 3 videos (lower is better):

| Audience    | Model | B0 channel average | B1 generic LLM | B2 no content | Model minus B0 (95% interval) | 80% band coverage |
| ----------- | ----- | ------------------ | -------------- | ------------- | ----------------------------- | ----------------- |
| All viewers | 15.4  | 18.5               | 18.9           | 12.8          | −3.1 (−10.2 to +7.1)          | 61%               |
| Subscribers | 30.1  | 19.8               | 17.9           | 26.2          | +10.3 (−3.5 to +33.5)         | 10%               |
| Newcomers   | 27.9  | 19.3               | 18.2           | 10.7          | +8.7 (−2.1 to +22.1)          | 40%               |

By video, curve error for all viewers:

| Video                                  | Model | B0   | B1   | B2   |
| -------------------------------------- | ----- | ---- | ---- | ---- |
| 4:22 cover (`lgxOjPdCGkw`)             | 7.7   | 17.9 | 9.7  | 15.5 |
| 3:42 cover (`FhcM0zUTVv0`)             | 3.6   | 9.9  | 13.4 | 6.9  |
| 88 s application video (`qIKLe-WFUbw`) | 34.8  | 27.7 | 33.7 | 15.9 |

**What this says, and does not say:**

- **The covers:** each was predicted by models trained on the other cover and the application video, and the model is close on both.
- **The application video:** it is unlike both training videos (shorter, talking rather than singing), and the full model is far off for every audience. With 2 training videos, the length column only tells the videos apart, so a new length extrapolates wildly. For subscribers and newcomers the median curve falls to almost 0 within a third of the video.
- **B2 beats the full model for newcomers** (10.7 vs 27.9). With 2 training videos, the content columns overfit. This is the ablation doing its job; with real data it would mean the content features add nothing.
- **Gemini's guesses** end at 8–11% still watching for all three videos. The measured ends are 10–20% for the covers and 33–45% for the application video. B1 is close on the covers and far too pessimistic on the application video.
- **YouTube's average view percentage** agrees with the measured curve's average within 2 points on every video and audience here. So the rewatch caveat matters for other channels, not this one.
- **None of it is a result.** Each number comes from a model fitted on 2 videos, and the card says so in its banner and in every verdict.

## Model gate

**Not passed.** No channel can be evaluated on held-out videos. A real test needs at least 6 test videos plus 30 training videos, about 38 settled, usable videos per channel; the test channel has 3.

**What changes next** (the plan for the Oct 10 gate day):

1. Recruit at least 2 channels with 40+ eligible videos each, the data gate from Phase 04. See `docs/notes/phase-04.md` for adding test users and connecting.
2. For each channel, run in order:
   - `soundcheck ingest …`
   - `soundcheck extract beats`
   - `soundcheck features`
   - `soundcheck-modeling fit-pooled`
   - `soundcheck-modeling fit --channel …`
   - `soundcheck baseline-llm --channel …`
   - `soundcheck-modeling evaluate --channel …`
3. Then run `soundcheck-modeling model-card`. The gate passes if the card reports, for at least one audience, a model that beats B0 with a 95% interval below zero, together with the calibration result.

**Until then, the spec says no UI.** Phases that build screens wait for a real number unless Nishchay decides otherwise, for example for a demo built on check-mode output. If so, record that decision in the notes and on the card.

## Decisions

By Nishchay:

- **Option 1:** build all of Phase 09 now, test it on synthetic data, and run it on the test channel as a labelled pipeline check. The gate is recorded as not passed.
- **The plan, with eight fixes:**
  1. check mode (leave-one-out) for small channels;
  2. the pooled prior refitted without the test videos;
  3. share-watched error scored against the measured curve, with YouTube's percentage shown for reference;
  4. drop-off peaks defined as the top 3 bins among 2–100, at least 4 apart;
  5. B0's stronger variant chosen on the test set, which favours the baseline;
  6. evaluation models kept out of `model_runs`;
  7. inflation fitted on validation videos, in holdout mode only;
  8. a Jinja2 template for the card.
- **Dependency:** Jinja2 3.1.6.

## Changes from the spec

All are recorded in `docs/plan/phase-09.md`.

- **Check mode,** for channels that cannot hold out 6 videos and keep 30 for training. The result is labelled `check` in `eval_runs`, the plots and the card, and never makes a claim.
- **The split's numbers** live in the TypeScript model config, exported to Python, so `baseline-llm` asks about the same videos the evaluation holds out. Each language has a mirrored test of the rule.
- **The share-watched error** is measured against the mean of the measured curve, not YouTube's average view percentage, which is shown beside it.
- **Drop-off peaks** are the 3 highest-hazard bins among bins 2–100, at least 4 bins apart, and a hit is within 3 bins.
- **Calibration** is checked on validation videos taken from the training set, and inflation is fitted there, in holdout mode only. The test bands are drawn again with the factor, never tuned on the test set.
- **`eval_runs`:**
  - status is `holdout`, `check` or `failed`;
  - `model_run_id` is the production run the evaluation vouches for (the evaluation's own run when a channel has none);
  - the row is validated against a schema exported from TypeScript.
- **Evaluation models** are stored with the evaluation, never in `model_runs`.
- **B1:** one curve per video for a typical audience, compared against each audience's curve. Answers that rise somewhere are made non-increasing and flagged `repaired`.
- **Plots** cover all audiences in one PNG per video, with B0 and B1 drawn too.

## Incidents

- **The full test suite's random-video test timed out once.** The 200-video property test from Phase 07 passed Vitest's 5-second limit while every package's tests ran together; on its own it takes 0.6 s. It now has a 30-second limit.
- **A shortcut in the inflation step.** I first widened the test bands around the median instead of drawing them again with the scaled covariance. Survival is not linear in the coefficients, so it now redraws them.
- **Settings read outside the settings module.** `model-card` first read `MIN_TRAIN_VIDEOS` from the environment directly. Each evaluation now records the minimum it used, and the card reads that.
- **Test mistakes:** a cost rounded the wrong way in an expected string ($0.02925 prints as 0.0292).
- **Something said wrongly in conversation:** after the Gemini run I said the measured curves end at "about 16–30%". Checked, they are 10–20% for the covers and 33–45% for the application video; the table above uses the checked numbers.
- **On synthetic data, even a correct model's raw 80% band covered only 15% of measured points.** The band describes the expected curve, but each video's measured curve also has its own noise. The inflation step (a factor of about 22 there) brought test coverage to 74%. Expect real channels to need it.

## Notes for later phases

- **The UI phases are blocked by the model gate** until a channel has a held-out result, unless Nishchay overrides it explicitly. Any screen built before then must not show check-mode numbers as results.
- **Evaluation never publishes anything.** Phase 10's publish step reads `model_runs` (production fits) and must also require `usable: true`. It can show the latest `holdout` evaluation from `eval_runs`, but never a `check` one.
- **Bands:**
  - expect inflation;
  - when a holdout evaluation fits a factor, the product should apply it to the bands it shows. Store the factor with the production model or read it from `eval_runs`; the artifact has no field for it yet.
- **B1 cost:** about $0.016 per video at current prices, for the test videos only. Gemini prices double on Jan 1, 2027.
- **Re-running:** `baseline-llm` and `evaluate` are safe to repeat. Curves are cached, and every evaluation adds an `eval_runs` row and plots; the card uses each channel's latest.
- **Generated files:** `docs/model-card.md`, `docs/eval/` and `services/modeling/schemas/` are generated; Prettier skips the card and the schemas.
