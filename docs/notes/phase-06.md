# Phase 06: Extraction quality gate

Oct 9, 2026

Gemini's beat extraction passed the quality gate after five iterations. Extraction version `beats-v5` agrees with itself across repeated runs on every gated measure, and a person who watched two test videos kept all 40 of its beats. The test channel's videos were re-extracted with `beats-v5`. The data gate is still not met: one channel, three videos.

The slide-ready summary is `docs/extraction-quality.md`.

Built in eight reviewed commits:

1. `Add agreement statistics for extraction quality`
2. `Measure extraction consistency across repeated runs` (iteration 0)
3. `Sharpen beat and framing definitions for the quality gate` (iteration 1, `beats-v2`)
4. `Merge framings to six labels for the quality gate` (iteration 2, `beats-v3`)
5. `Describe the picture as talking-head share and visual` (iteration 3, `beats-v4`)
6. `Sharpen energy and visual rules so the extraction gate passes` (iteration 4, `beats-v5`)
7. `Compare Gemini's beat types with a human's`
8. `Verify Phase 06 and write the extraction quality report` (the gate summary, the Turborepo cache fix and these notes)

## Done when

| Item                                                                                              | Status      | Evidence                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| All gate thresholds met, or a documented decision to collapse categories with the passing numbers | Done        | `beats-v5` passes every threshold (table below). Getting there collapsed `framing` into six labels and then replaced it with `talking_head_share` and `visual`; each step is recorded below |
| Human agreement reported                                                                          | Done        | 40 of 40 beats kept by the reviewer; Gemini versus those labels: kappa 0.68, the same type for 82% of 1,052 s, boundary F1 0.81. Method: a reviewed Gemini draft, not blind labels          |
| Full extraction complete for every recruited channel, total cost recorded                         | Done        | The one connected channel: all 4 videos re-extracted with `beats-v5`, **$0.089** ($0.0088 per minute of video). BigQuery now holds only `beats-v5` beats (23)                               |
| Data gate checked: 2 or more channels with 40 or more videos having curves and beats              | **Not met** | 1 channel; 3 videos with retention curves and `beats-v5` beats                                                                                                                              |
| `docs/notes/phase-06.md` written                                                                  | Done        | This file                                                                                                                                                                                   |

Also verified:

- **`quality_reports`** holds 5 consistency reports, 1 human-agreement report and the gate summary (`extraction-quality-gate`).
- **`pnpm check`** passes all 20 tasks with the cache forced off (core 410 tests, pipeline 120, web 24, ui 4).

## Iterations

All on the same six videos (65 minutes):

- **Test set:** tutorial 26:39, vlog 14:55, review 16:36, explainer 2:37, the channel's 3:42 music video and 0:31 Short.
- **Runs:** three per video, seeds 20261004 to 20261006, temperature 0.
- **Scoring:** averaged over the three pairs of runs, with per-second labels pooled across the videos.

| Iteration | Version  | Boundary F1 | beat_type κ | framing/visual κ | energy wκ | assumed knowledge wκ | info density wκ | talking head share wκ | Gate |
| --------- | -------- | ----------- | ----------- | ---------------- | --------- | -------------------- | --------------- | --------------------- | ---- |
| 0         | beats-v1 | 0.80        | 0.58        | 0.42             | 0.72      | 0.90                 | 0.83            | n/a                   | fail |
| 1         | beats-v2 | 0.78        | 0.72        | 0.37             | 0.57      | 0.91                 | 0.85            | n/a                   | fail |
| 2         | beats-v3 | 0.79        | 0.76        | 0.58             | 0.58      | 0.89                 | 0.84            | n/a                   | fail |
| 3         | beats-v4 | 0.73        | 0.66        | 0.63             | 0.41      | 0.82                 | 0.71            | 0.76                  | fail |
| 4         | beats-v5 | 0.76        | 0.65        | 0.81             | 0.75      | 0.78                 | 0.78            | 0.70                  | pass |
| Needs     |          | ≥ 0.7       | ≥ 0.6       | ≥ 0.7            | ≥ 0.5     | ≥ 0.5                | ≥ 0.5           | ≥ 0.5                 |      |

| Iteration | Cost  | Most confused                                                                                                                                                  | What changed next                                                                                       |
| --------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0         | $1.19 | beat_type: demonstration/explanation 1,215 s, demonstration/payoff 503 s. framing: mixed vs everything (mixed/screen_recording 1,661 s)                        | Sharper definitions and tie-break rules (Nishchay: "sharpen definitions first")                         |
| 1         | $1.25 | demonstration/explanation 960 s. framing: still mixed (mixed/screen_recording 1,905 s, mixed/talking_head_static 1,839 s)                                      | Six framings: no `mixed`, one `talking_head`, slides in `graphics` (option 2)                           |
| 2         | $1.20 | framing: screen_recording/talking_head 1,291 s, b_roll/talking_head 1,236 s: beats that cut between a presenter and something else                             | `framing` replaced by `talking_head_share` (1 to 5) and `visual` (option 1)                             |
| 3         | $1.15 | visual: b_roll/graphics 566 s; energy fell to 0.41. The tutorial's run 2 failed (rate limits, then "fetch failed"), so two of three pairs compared five videos | Observable energy anchors, sharper visual rules, 2 calls at a time, failed calls re-run once (option A) |
| 4         | $1.26 | beat_type: demonstration/explanation 664 s, explanation/opinion 371 s. visual: b_roll/screen_recording 574 s                                                   | Passed                                                                                                  |

Final-iteration detail:

- **Per pair of runs:**

  | Pair | Videos | Boundary F1 | beat_type κ | visual κ | energy wκ |
  | ---- | ------ | ----------- | ----------- | -------- | --------- |
  | 1–2  | 5      | 0.84        | 0.76        | 0.83     | 0.93      |
  | 1–3  | 5      | 0.73        | 0.58        | 0.83     | 0.68      |
  | 2–3  | **6**  | 0.72        | 0.61        | 0.77     | 0.63      |

  The vlog's run 1 failed twice on a network timeout, so pairs 1–2 and 1–3 compare five videos. Pair 2–3 compares all six and passes every threshold on its own.

- **Payoff time** was 0.2 s apart on average, but only 10 payoffs were compared: in 5 of the 16 video pairs, one run reported a payoff and the other none. In iteration 0 the payoffs were 195 s apart.

## Human agreement

- **Method.** `soundcheck consistency human --draft` wrote Gemini's `beats-v5` labels for the explainer (10 beats) and the vlog (30 beats) into `docs/quality/human-labels/`, keeping `.draft.csv` copies. Nishchay watched both videos and judged every beat correct, so nothing was changed.
- **Comparison.** `soundcheck consistency human` then ran a fresh extraction and compared it with the confirmed labels:

  | Video     | κ        | Same type | Boundary F1 |
  | --------- | -------- | --------- | ----------- |
  | Explainer | 0.99     | 99%       | 1.00        |
  | Vlog      | 0.48     | 79%       | 0.73        |
  | **Both**  | **0.68** | **82%**   | **0.81**    |

  The fresh run gave the vlog 21 beats where the draft had 30.

- **Biggest disagreements** (Gemini / human): story/opinion 49 s, story/explanation 44 s, outro/end_screen 42 s.
- **Cost:** $0.13.

Nishchay chose to review Gemini's draft instead of labelling blind, to save time. Agreement measured that way is biased upward. The report labels its method `reviewed-draft` and counts the beats changed.

## What exists

- **Core:**
  - `@soundcheck/core/stats` (`agreement.ts`): `cohenKappa`, `quadraticWeightedKappa`, `boundaryF1`, `spearman`, `meanAbsoluteDifference`, `perSecond`, `bothLabelled`, `internalBoundaries`, `confusionMatrix`;
  - `jobs/quality.ts`: quality reports stored as JSON under `{channel}/quality-reports/`, and `quality_reports` rebuilt from all of them, so every iteration is kept;
  - the extractor takes `writeCache`, `temperature`, `seed` and an archive location, and error messages keep a network failure's cause.
- **Schema (`beats-v3`):** `framing` is gone. `talking_head_share` (1 to 5) and `visual` (`screen_recording`, `b_roll`, `graphics`, `gameplay`, `other`, `none`) replace it.
- **Prompt (`beats-v5`):**
  - sharper beat types with tie-break rules;
  - a Picture section;
  - observable energy anchors;
  - a payoff defined as the short moment the promise is delivered.

  The two examples were converted mechanically (talking head, share 5, visual none).

- **Pipeline:** `soundcheck consistency runs | human [--draft] | gate --channel UC…`, with the fixed test set in `consistency/test-set.ts`.
- **Docs:** `docs/extraction-quality.md` and `docs/quality/human-labels/` (README, the two confirmed CSVs and their drafts).
- **Tooling:** `turbo.json` has a `transit` task, so lint, typecheck and tests re-run when a dependency's source changes.

## Decisions

Approved at planning:

- **A.** Test set: four public videos picked by Nishchay (tutorial, vlog, review, explainer) plus the channel's two non-example videos.
- **B.** Human labels for two videos.
- **C.** Kappa pooled over all videos for each pair of runs.
- **D.** A different seed per run, plus temperature 0.4 if the runs were identical (they never were).
- **E.** Consistency runs never touch the cache or the beat tables.

Made during the build, by Nishchay:

- **Iteration 1:** sharpen definitions first, merge only if needed.
- **Iteration 2:** remove `mixed` and merge the talking heads and slides (option 2).
- **Iteration 3:** describe the picture as a share and a visual (option 1).
- **Iteration 4:** fix the measurement and sharpen energy and visual (option A).
- **Human labels:** for the explainer and the vlog, reviewing Gemini's draft rather than labelling blind.
- **Billing:** upgraded the billing account from Free Trial to Paid (the credit is kept).
- **No `undici` dependency** for a longer HTTP wait (see "Notes for later phases").

## Changes from the spec

All are recorded in `docs/plan/phase-06.md`.

- **The labels changed to pass.**
  - `framing` became `talking_head_share` and `visual`;
  - `visual` is held to framing's kappa threshold (0.70), and the share joins the ordinal fields (0.50).
- **Measurement:**
  - every run uses its own seed;
  - per-second labels are pooled across videos for each pair of runs;
  - consistency runs bypass and never write the cache;
  - 2 calls at a time;
  - a failed call is re-run once at the end.
- **Commands.** `consistency` became `consistency runs`, with `consistency human` and `consistency gate` added. The gate summary row is written by `consistency gate`, not by the runs.
- **Human agreement** used a reviewed Gemini draft, with the bias reported.
- **Weighted kappa's test.** No published worked example was at hand, so it is tested against its identity with Lin's concordance correlation: one hand-checked example, and a property test on random ratings (to 9 decimal places). Cohen's kappa and Spearman use Wikipedia's worked examples.

## Incidents

- **Stale test results from the Turborepo cache.**
  - What happened: `lint`, `typecheck` and `test` had no `dependsOn`, so a change in `packages/core` never invalidated the cache of the packages that use it. The web health-check test hardcoded `beats-v1`, and it had been failing since iteration 1 while `pnpm check` replayed a cached pass.
  - How it was found: running each package's tests directly while writing these notes.
  - Fix: a `transit` task (Turborepo's documented pattern), and the test now uses the version constants.
  - Verification: a forced run of every task found nothing else stale, and a test edit to core now makes web's tests run again.
- **Rate limits and 5-minute timeouts.**
  - What happened:
    - iteration 3 lost one of the tutorial's runs to rate limits (429) and then "fetch failed";
    - iteration 4 had six calls fail with "fetch failed", five of which the end-of-run re-run recovered;
    - the first two human comparisons failed the same way on the 2:37 explainer.
  - The cause, once error messages kept it: `UND_ERR_HEADERS_TIMEOUT`. Node's fetch gives up when a server sends nothing for 5 minutes, and Vertex AI sometimes took that long to start answering while the account was on the Free Trial.
  - A streamed test call opened only after 193 s, because Vertex sends nothing until its first token, so streaming does not help.
  - After Nishchay upgraded billing to Paid, the next comparison finished in 6 minutes with no timeouts. One run is not proof that the upgrade fixed it.
- **Test-only mistakes.** Some expectations were wrong; the code was right each time:
  - a hand-computed kappa;
  - a call count (7 calls, not 8, for one failed extraction plus its retry);
  - a test date earlier than the seeded reports;
  - the energy anchors wrapping onto two lines.

## Notes for later phases

- **Phase 07:**
  - Build features from `beats-v5` only.
  - Before training, check `quality_reports` for an `extraction-quality-gate` row whose `details.passed` is true for the current `EXTRACTION_VERSION`.
  - Rows from any other version have not passed the gate.
- **Use the new fields.** `talking_head_share` (1 to 5) and `visual` replace `framing`, and are in `beats.details`.
- **Beat types are the weakest gated label** (0.58 to 0.76 across pairs).
  - The persistent confusions are demonstration vs explanation, and story vs opinion or explanation in vlogs.
  - If features built on beat types turn out noisy, merging demonstration and explanation is the obvious next collapse; it would need a new gate run.
- **Payoff time is unstable:** in a third of the video pairs, one run finds a payoff and the other none. Treat it with care as a feature.
- **Any prompt, label, example or model change** needs `soundcheck consistency runs`, then `consistency gate`, before its data is used: about $1.25 an iteration at current prices.
- **Long videos and timeouts.**
  - Nishchay chose not to add `undici` to raise Node's 5-minute wait.
  - If long videos (20 minutes or more) fail with `UND_ERR_HEADERS_TIMEOUT` during real extractions, revisit that: the SDK accepts a custom `fetch`, so a `undici` Agent with longer `headersTimeout` and `bodyTimeout` would fix it.
  - Until then, `extract beats` reports such videos as `failed`, and a re-run extracts them.
- **Billing is Paid now.**
  - The $300 credit lasts until about early January 2027, then usage is charged.
  - The ₹4,200 budget alert only warns.
  - Gemini prices double on Jan 1, 2027.
- **Data gate:** still needs at least two channels with 40+ videos. See `docs/notes/phase-04.md` for the steps; each new channel needs ingest, then `extract beats` (about $0.0088 per minute of video).
- **Phase 06 spend:** about $6.45 in all (gate $6.19, human draft about $0.13, full re-extraction $0.09, plus a few test calls).
