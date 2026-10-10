# Phase 08: The audience model

Oct 10, 2026

Soundcheck now fits a model per channel and audience, stores it as a JSON artifact, and predicts from it in TypeScript with uncertainty bands and readable traits.

On the test channel:

- every model converged, but each is marked not usable: 3 videos, where 30 are needed;
- the traits are mostly "can't tell yet", which is the honest answer from 3 videos.

**Built in six reviewed commits:**

1. `Define the model artifact contract`
2. `Fit the hazard model in Python`
3. `Predict and sample survival curves in TypeScript`
4. `Turn models into traits`
5. `Scale the model covariance by the estimated dispersion`
6. `Verify Phase 08 and write the notes`

## Done when

| Item                                                                                    | Status           | Evidence                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Synthetic recovery test and the cross-language parity test pass                         | Done             | Recovery: 60 synthetic videos, every coefficient within 0.02 of the truth and the intercept within 0.03. Parity: TypeScript matches Python's hazards to a worst difference of 6.2e-17 (limit 1e-9) |
| Pooled and per-channel models trained for every usable channel and audience             | Done (1 channel) | `hazard-v2`: pooled run `234270fb`, channel run `ccf38c5d`; all 3 audiences fitted and converged; every model marked not usable (see "Live fits")                                                  |
| Runs visible in Vertex AI Experiments                                                   | Done             | Experiment `soundcheck-models` lists 12 runs (`hazard-v1` and `hazard-v2`, pooled and channel, 3 audiences each) with their parameters and metrics                                                 |
| The traits list for one channel pasted into the notes, with a sanity read from the team | Done             | "Traits" below; sanity read by Nishchay                                                                                                                                                            |
| `docs/notes/phase-08.md` written                                                        | Done             | This file                                                                                                                                                                                          |

**Also verified:**

- **`model_runs`** has 12 rows, all `fitted`, each linked to its Experiments run with no logging errors.
- **Artifacts** pass the exported JSON Schema; they are 13.5 KB (20 columns) and 35.7 KB (35 columns).
- **`pnpm check`** passes 20 tasks: core 469 tests, pipeline 132, web 24, ui 4, modeling 33.

## Live fits

`uv run --env-file ../../.env soundcheck-modeling fit-pooled`, then `fit --channel UC-BHlgFbFh3V76yth-XCmlw`, Oct 10, 2026. All runs are on feature version `feat-bf1e3064fa6f`.

| Model       | Columns kept | Lambda (by 3-fold cross-validation) | Held-out loss at 0.1 / 1 / 10 / 100   | Dispersion | Effective parameters | Median coefficient sd |
| ----------- | ------------ | ----------------------------------- | ------------------------------------- | ---------- | -------------------- | --------------------- |
| All viewers | 20 of 28     | 1                                   | 0.0829 / **0.0820** / 0.0838 / 0.0842 | 1.5e-3     | 9.0                  | 0.037                 |
| Subscribers | 20 of 28     | 10                                  | 0.1005 / 0.0873 / **0.0867** / 0.0867 | 1.9e-3     | 7.3                  | 0.014                 |
| Newcomers   | 35 of 49     | 10                                  | 0.0948 / 0.0895 / **0.0889** / 0.0891 | 2.2e-3     | 7.6                  | 0.015                 |

- **Dropped columns:** the 8 never vary in these videos. They are 6 beat types (sponsor, intro branding, CTA, tangent, recap, payoff) and 2 visuals (b-roll, screen recording), plus their 6 interactions for newcomers.
- **Pooled models:** fitted with lambda 0.1. Each is marked not usable as a prior ("pooled from 1 channel; a prior needs at least 2"), so the channel models shrink toward 0.
- **Convergence:** every fit reached a gradient of 1.4e-11 or less.
- **Time:** each command takes 1 to 2 minutes, almost all of it Vertex Experiments calls; fitting takes about a second.

## Traits

`pnpm --filter @soundcheck/pipeline soundcheck traits --channel UC-BHlgFbFh3V76yth-XCmlw`:

```
Traits for UC-BHlgFbFh3V76yth-XCmlw (hazard-v2 on feat-bf1e3064fa6f)
  Simulated on FhcM0zUTVv0 (222 s), the median length of 3 training videos.
  Change in viewers still watching at the end, with a 90% interval. Associations in past videos, not causes.

  All viewers (run ccf38c5d; not usable: trained on 3 videos; at least 30 are needed)
    a 30 s sponsor read at 30%                           not learned: it never varies in the training videos
    a 15 s branded intro at the start                    not learned: it never varies in the training videos
    a 15 s call to action at 50%                         not learned: it never varies in the training videos
    a 45 s tangent at 50%                                not learned: it never varies in the training videos
    a 30 s recap at 70%                                  not learned: it never varies in the training videos
    a 20 s payoff beat at 75%                            not learned: it never varies in the training videos
    60 s of static talking head at 40%                   +0.0 pp (-0.1 to +0.2)
    60 s of b-roll at 40%                                not learned: it never varies in the training videos
    60 s of screen recording at 40%                      not learned: it never varies in the training videos
    30 s of foreground music at 50%                      +0.0 pp (-0.0 to +0.0)
    twice as many cuts throughout                        -1.0 pp (-5.0 to +4.3)
    on-screen text throughout                            -3.8 pp (-12.3 to +13.4)
    one point more energy throughout                     +1.8 pp (-1.2 to +6.0)
    one point denser throughout                          +0.9 pp (-0.9 to +2.8)
    one point more assumed knowledge throughout          +0.3 pp (-3.3 to +4.3)
    speech 20% faster throughout                         +0.2 pp (-0.0 to +0.4)
    beats half as long                                   +0.1 pp (-0.7 to +1.0)
    a question opened at the start and answered at 75%   +1.2 pp (-1.4 to +3.6)
    the title's promise delivered at 25%                 -1.9 pp (-3.2 to -0.7)

  Subscribers (run ccf38c5d; not usable: trained on 3 videos; at least 30 are needed)
    a 30 s sponsor read at 30%                           not learned: it never varies in the training videos
    a 15 s branded intro at the start                    not learned: it never varies in the training videos
    a 15 s call to action at 50%                         not learned: it never varies in the training videos
    a 45 s tangent at 50%                                not learned: it never varies in the training videos
    a 30 s recap at 70%                                  not learned: it never varies in the training videos
    a 20 s payoff beat at 75%                            not learned: it never varies in the training videos
    60 s of static talking head at 40%                   -0.0 pp (-0.1 to +0.1)
    60 s of b-roll at 40%                                not learned: it never varies in the training videos
    60 s of screen recording at 40%                      not learned: it never varies in the training videos
    30 s of foreground music at 50%                      -0.0 pp (-0.0 to +0.0)
    twice as many cuts throughout                        -0.1 pp (-2.0 to +2.2)
    on-screen text throughout                            -0.2 pp (-6.8 to +7.4)
    one point more energy throughout                     +0.3 pp (-1.0 to +1.7)
    one point denser throughout                          +0.2 pp (-0.6 to +0.9)
    one point more assumed knowledge throughout          -0.0 pp (-1.7 to +1.6)
    speech 20% faster throughout                         +0.0 pp (-0.1 to +0.1)
    beats half as long                                   -0.0 pp (-0.4 to +0.4)
    a question opened at the start and answered at 75%   +0.2 pp (-0.8 to +1.3)
    the title's promise delivered at 25%                 -0.2 pp (-0.9 to +0.4)

  Newcomers (run ccf38c5d; not usable: trained on 3 videos; at least 30 are needed)
    a 30 s sponsor read at 30%                           not learned: it never varies in the training videos
    a 15 s branded intro at the start                    not learned: it never varies in the training videos
    a 15 s call to action at 50%                         not learned: it never varies in the training videos
    a 45 s tangent at 50%                                not learned: it never varies in the training videos
    a 30 s recap at 70%                                  not learned: it never varies in the training videos
    a 20 s payoff beat at 75%                            not learned: it never varies in the training videos
    60 s of static talking head at 40%                   +0.0 pp (-0.1 to +0.1)
    60 s of b-roll at 40%                                not learned: it never varies in the training videos
    60 s of screen recording at 40%                      not learned: it never varies in the training videos
    30 s of foreground music at 50%                      +0.0 pp (-0.0 to +0.0)
    twice as many cuts throughout                        -0.2 pp (-2.1 to +1.8)
    on-screen text throughout                            -0.8 pp (-5.8 to +6.6)
    one point more energy throughout                     +0.4 pp (-1.0 to +1.8)
    one point denser throughout                          +0.2 pp (-0.6 to +1.1)
    one point more assumed knowledge throughout          +0.2 pp (-1.4 to +2.1)
    speech 20% faster throughout                         +0.0 pp (-0.1 to +0.1)
    beats half as long                                   +0.1 pp (-0.4 to +0.4)
    a question opened at the start and answered at 75%   +0.3 pp (-0.8 to +1.4)
    the title's promise delivered at 25%                 -0.3 pp (-0.7 to +0.2)

  Estimated audiences, from the newcomer model:
    search: hidden (trained on 3 videos; at least 30 are needed; no trait's interval excludes zero)
    suggested: hidden (trained on 3 videos; at least 30 are needed; no trait's interval excludes zero)
    browse: hidden (trained on 3 videos; at least 30 are needed; no trait's interval excludes zero)
```

**Sanity read (Nishchay):** "Payoff timing looks right; on-screen text is misleading (it's just the end screen); the rest can't be judged from 3 videos."

Reading the list:

- **"The title's promise delivered at 25%"** moves this video's payoff from 10 s to 55 s, so it is later, not earlier. Losing 1.9 points matches Phase 07, where `before_payoff` went with higher hazard. It is the only interval that excludes zero, and that probably overstates the certainty (see "Notes for later phases").
- **On-screen text** occurs only in the 6-second end screen, where viewers leave because the video ends. The model cannot tell those apart.
- **Static talking head, foreground music and speech speed** barely vary across the three videos (two song covers and an application video, all to camera), so their effects are about 0.

## Decisions

By Nishchay:

- **The plan, with ten fixes:**
  1. the model's columns (position, the 20 starting features, plus mix and interactions for newcomers) live in TypeScript and are exported for Python;
  2. `static_talking_head_share` replaces the removed framing;
  3. columns that never vary are dropped per fit;
  4. pooled coefficients are converted into each channel's units;
  5. `min(5, videos)` cross-validation folds;
  6. the artifact gains the channel context and its other extra fields;
  7. models below `MIN_TRAIN_VIDEOS` are kept but marked not usable;
  8. `model_runs` gets an `audience` column;
  9. Experiments runs without a TensorBoard;
  10. a `soundcheck traits` command.
- **Dependencies:** `google-cloud-storage`, `google-cloud-aiplatform` and `jsonschema` (Python), and `ml-matrix` 6.15.0 (TypeScript). No `pure-rand` and no `db-dtypes`.
- **Uncertainty:** scale the covariance by the quasi-likelihood dispersion. The other options were per-video robust errors, which can't produce intervals with fewer than about 30 videos, and keeping the spec's covariance.
- **The sanity read** above.

## Changes from the spec

All are recorded in `docs/plan/phase-08.md`.

- **Columns:** 28 for all viewers and subscribers, 49 for newcomers, from `model-config.json`. Video-level columns are not used.
- **Covariance:** the Laplace covariance is scaled by the quasi-likelihood dispersion (`hazard-v2`). With the spec's weights it was about 140 times too wide. Every sampled curve fell to 0, and the traits read "−0.0 to +0.0", which looks precise but means nothing.
- **Optimization:** Newton steps polish the L-BFGS-B solution. Convergence is judged by the gradient and a positive-definite Hessian, not by L-BFGS-B's status flag, which often reports a line-search failure at the optimum.
- **The prior** is used only when the pooled model covers at least 2 channels. The pooled model's lambda is fixed at 0.1 with no cross-validation.
- **Cross-validation:** `min(5, videos)` folds; ties go to the larger lambda; lambda is 10 without 2 videos.
- **The artifact** has more fields than the spec lists:
  - `extractionVersion`, `createdAt`, `droppedFeatures`, `unpenalized`, `trainChannelIds`, `channelContext`, `usable` and `unusableReasons`;
  - in `metrics`, the dispersion and effective parameters.
- **The channel context** comes from a new `feature_contexts` table, written by `soundcheck features`, so Python never recomputes it.
- **`model_runs`** gets an `audience` column, the statuses `fitted`, `not_converged`, `no_data` and `failed`, and `pooled` as the channel of pooled runs.
- **Parity fixtures** are made in two steps: TypeScript writes the frame, then Python writes the artifact and the expected hazards.
- **Traits** are computed by the new `soundcheck traits` command, on the training video of median length.
  - Each trait is the change in viewers still watching at the end of the video, with a 90% interval from draws applied to both the original and the edited video.
  - There are 19 scenarios.
  - Features the model never learned get no number.

## Incidents

- **Uncertainty far too wide.** This was found in the first live traits.
  - A diagnosis showed the logit hazard's standard deviation was 5.6 per bin, and sampled survival at the end was about 1e-31 against an estimate of 0.158.
  - On synthetic data with the production weights, the spec's covariance predicted a coefficient spread about 140 times the real one; with the dispersion it predicts within about 10%.
  - Fixed in `9f308bd`; `MODEL_VERSION` moved to `hazard-v2`.
- **Test mistakes** (the code was right each time):
  - a penalty too weak for the size of its synthetic data;
  - a band test that assumed the median curve equals the point estimate, which only holds when uncertainty is small;
  - a table description with `''` for an apostrophe, which BigQuery rejects.
- **`MaxListenersExceededWarning`** appears on stderr whenever `soundcheck traits` downloads artifacts. It comes from `@google-cloud/storage` 8.2.0's `download()`; a single download triggers it, and parallel BigQuery reads do not. It is harmless and left alone.
- **Typing:** scipy, jsonschema and google-cloud-storage ship no type information, so mypy skips their imports.

## Notes for later phases

- **Phase 09 (evaluation):**
  - **Check calibration.** Check the 10–90% bands and the 90% trait intervals on held-out videos. The dispersion treats bins as independent, but bins of one video are correlated, so the bands are probably too narrow.
  - **If they are too narrow,** switch to a per-video robust (sandwich) covariance, which is workable once channels have 30+ videos, or inflate the bands.
  - **Hold out whole videos,** as the cross-validation already does.
- **Never ship a model with `usable: false`.** Phase 10 publish must check it, and the artifact carries the reasons.
- **Predictions need `artifact.channelContext`:** build frames with `buildBins(video, durationS, artifact.channelContext, mix)`. For newcomers use `channelContext.mixMean` (a typical newcomer); for an estimated audience, a mix of 1 for that source.
- **Feature candidate (on-screen text vs end screens):** on-screen text is confounded with end screens, as the sanity read noticed. Leaving `beat_end_screen` out of the model is one cause. Adding it, or measuring on-screen text outside end screens, would change `FEATURE_VERSION` and `MODEL_VERSION`. Decide that before Phase 09's held-out results, or re-run the evaluation from scratch after it.
- **Trait conditions are relative to the typical video:** "the payoff at 25%" can mean later. The UI should phrase conditions against the video being edited.
- **The pooled model** is only a prior from 2 channels on. Deleting a channel removes its artifacts and `model_runs` rows (by prefix and by `channel_id`), but the pooled coefficients still reflect its data, so refit the pooled models after a deletion.
- **Re-running:** `soundcheck features` (writes `feature_contexts`), then `soundcheck-modeling fit-pooled`, then `fit --channel …` for each channel, then `soundcheck traits`.
- **After a change:**
  - **Model columns or settings:** run `pnpm gen:schemas`, bump `MODEL_VERSION` and refit.
  - **The fitter's maths:** bump `MODEL_VERSION`.
- **Experiments calls** take 20 to 45 seconds per run (the first also creates the experiment), which is fine in a job. The experiment is in `us-central1` (`GCP_REGION`).
- **Data gate:** still unmet (1 channel, 3 videos). Every model stays not usable until a channel has 30+ videos.
