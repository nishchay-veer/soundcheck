# Phase 04: Retention curves

Oct 7, 2026

For every eligible video, Soundcheck now stores the measured retention curve for each audience in BigQuery:

- **Audiences:** all viewers, subscribers, non-subscribers, and organic viewers when ads bring more than 2% of views.
- **Each curve** is a 100-point series with monotone survival (`s_mono`), a hazard per bin, and rewatch measures.
- **Coverage:** a row per video and audience records whether a curve exists and why not.
- **Report:** a printed table says whether the channel has enough data to model.

Built in four reviewed commits:

1. `Probe the audience retention report`
2. `Derive monotone survival and hazards from retention curves`
3. `Ingest retention curves for each audience`
4. `Verify Phase 04 live and write the notes` (these notes and the plan update)

## Done when

Verified Oct 7, 2026 on channel `UC-BHlgFbFh3V76yth-XCmlw`, data through 2026-10-03, `MIN_VIEWS=200`.

| Item                                                                      | Status           | Evidence                                                                                                                                                |
| ------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage report run on every recruited channel and pasted into the notes  | Done (1 channel) | "Coverage report" below. Only one channel is connected                                                                                                  |
| At least two channels meet the 40-video bar (this is the data gate input) | **Not met**      | 1 channel with 3 complete videos (3 of 40). The gate is blocked on recruiting creators; see "Data gate"                                                 |
| Hazard reconstruction property test passes                                | Done             | fast-check: survival rebuilt from hazards matches `s_mono` within 1e-9. Live, the same rebuild in SQL over all 900 stored points matches within 3.3e-16 |
| Total API calls per channel logged                                        | Done             | `analytics_queries` in the `ingest-retention finished` log line and the report: 18 for this channel                                                     |
| `docs/notes/phase-04.md` written                                          | Done             | This file                                                                                                                                               |

Also verified:

- **No duplicates:** after a forced re-run, `retention_curves` has 900 rows (3 videos × 3 audiences × bins 1–100) and `retention_coverage` has 12, with 0 duplicate keys and 0 staging tables left.
- **Labels:** `s_mono` never goes above 1, and there are 0 negative hazards.
- **Container:** the pipeline Docker image builds, `ingest retention --help` runs in it, and `p-limit` loads.
- **Checks:** `pnpm check` passes all 20 tasks (core 272 tests, pipeline 69, web 24, ui 4), and `pnpm build` passes.

## Coverage report

`pnpm --filter @soundcheck/pipeline soundcheck ingest retention --channel UC-BHlgFbFh3V76yth-XCmlw`:

```
Retention coverage for UC-BHlgFbFh3V76yth-XCmlw (data through 2026-10-03)
  Eligible videos                                  3
  Complete subscribed and unsubscribed curves      3
  Median views per eligible video                  314
  Analytics calls                                  18
  Usable for modeling (40+ complete videos)        no (3 of 40)

  Audience                 complete            partial  insufficient_data            skipped
  all                             3                  0                  0                  0
  subscribed                      3                  0                  0                  0
  unsubscribed                    3                  0                  0                  0
  organic                         0                  0                  0                  3

  Segment counts (startedWatching, stoppedWatching) for 9 curves: 0 available, 9 empty, 0 errors, 0 not requested
```

Per curve (videos numbered by publish date):

| Video    | Audience     | Rewatch bumps | Rewatch mass | Watch ratio, bin 1 | Hazard, bin 1 | `s_mono` at bin 50 | `s_mono` at bin 100 |
| -------- | ------------ | ------------- | ------------ | ------------------ | ------------- | ------------------ | ------------------- |
| 1 (4:22) | all          | 3             | 0.825        | 0.984              | 0.016         | 0.375              | 0.133               |
| 1        | subscribed   | 2             | 0.313        | 0.98               | 0.02          | 0.424              | 0.202               |
| 1        | unsubscribed | 6             | 1.848        | 0.986              | 0.014         | 0.352              | 0.1                 |
| 2 (3:42) | all          | 3             | 0.847        | 1.059              | 0             | 0.367              | 0.122               |
| 2        | subscribed   | 11            | 1.312        | 0.933              | 0.067         | 0.244              | 0.156               |
| 2        | unsubscribed | 4             | 1.199        | 1.089              | 0             | 0.387              | 0.115               |
| 3 (1:28) | all          | 0             | 3.048        | 1.354              | 0             | 0.631              | 0.438               |
| 3        | subscribed   | 11            | 1.071        | 1.048              | 0             | 0.691              | 0.333               |
| 3        | unsubscribed | 1             | 3.453        | 1.399              | 0             | 0.612              | 0.447               |

Organic was skipped for all three videos ("ad views 0.0% of views, not above 2%"): the channel runs no ads.

## What exists

- **Core**
  - `@soundcheck/core/stats`, in `survival.ts`:
    - `monotoneSurvival`, a running minimum capped at 1;
    - `hazards`, clipped to [0, 0.999], and 0 once survival is 0;
    - `rewatchBumps`, counting rises of more than 0.02;
    - `rewatchMass`, `survivalFromHazards` and `survivalLabels`.
  - `@soundcheck/core/youtube`, in `retention.ts`:
    - `AUDIENCE_SLICES`;
    - `retentionQuery`, with `RETENTION_METRICS` for the curve and `SEGMENT_METRICS` for the separate segment-count call;
    - the pure parsers `parseRetentionPoints` and `parseSegmentCounts`;
    - `curveRows` (curve rows with `s_mono` and hazard, plus the coverage row) and `skippedCoverageRow`.
  - `queryReport(auth, query, { log, maxAttempts })`, so optional queries can use fewer retries.
  - `@soundcheck/core/jobs`: `readChannelRows(table, columns, channelId)` for steps that build on earlier tables.
  - Schemas:
    - `audienceSchema` (`all`, `subscribed`, `unsubscribed`, `organic`);
    - `retentionCurveRowSchema` and `retentionCoverageRowSchema`;
    - `coverageStatusSchema` (`complete`, `partial`, `insufficient_data`, `skipped`).
- **Pipeline:** `soundcheck ingest retention --channel UC… [--force]`, in `ingest/retention.ts`:
  - five calls at a time through p-limit;
  - prints the coverage table (`formatCoverage`);
  - refuses to run before catalogue, stats and mix.
- **Infra:** `infra/bigquery/migrations/002-retention-coverage.sql` (applied) adds `points`, `rewatch_bumps` and `rewatch_mass` to `retention_coverage`. The DDL file matches.
- **Scripts:**
  - `probe-analytics.ts` has retention probes, `--only <label prefix>`, and two attempts per query.
  - `record-fixtures.ts` records six retention responses.

## Decisions

Approved at planning:

- **A. Data gate.** Build and verify on the one connected channel, and record the 40-video gate as not met, blocked on recruiting.
- **B. Survival rules.**
  - `s_mono` is capped at 1, and the hazard is 0 once survival reaches 0.
  - The 1e-9 property applies to curves whose survival stays above 0, so clipping never applies. Clipping has its own tests.
- **C. Storage.** Three new `retention_coverage` columns. A skipped organic slice gets status `skipped`, with the reason in `details`.

Made during the build, after the probe and at Nishchay's request to "get everything we need":

- **Segment counts** (`startedWatching`, `stoppedWatching`) are requested on every curve in a second call, with 2 attempts. They're stored whenever YouTube returns them. Otherwise `details.segment_counts` records `empty` or `error` (with the message), so the gap is visible and never silent.

## Changes from the spec

All are recorded in `docs/plan/phase-04.md`.

- **The curve and the segment counts are two calls.**
  - The spec's five metrics together return no rows.
  - `startedWatching` and `stoppedWatching` return HTTP 500 alone (with or without filters, any date range), and no rows together.
  - Adding either to a working metric returns HTTP 500.
- **End date** is today minus 3 days in Pacific time, and the start date is the publish date in Pacific time, as in Phase 03.
- **Ad share for organic** comes from the `ADVERTISING` traffic source in `video_traffic_mix`. No report gives views by `audienceType`. Retention therefore needs stats and mix to have run.
- **Survival rules**, as decided in B.
- **`rewatch_mass` and `rewatch_bumps`** are kept per video and audience, since each audience has its own curve.
- **Coverage** gains `skipped`, `points`, `rewatch_bumps`, `rewatch_mass` and `details.segment_counts`.
- **Rule 7 skipping** works as in Phase 03: step `ingest-retention` and `INGEST_VERSION`, with `--force` to redo.

## Data gate

The spec's gate is at least two channels with 40 or more videos that have complete subscribed and unsubscribed curves. It is **not met**: one channel, three complete videos.

Two things block it:

1. **Testing mode.** The OAuth consent screen is in Testing mode, so each creator's Google account must be added as a test user (100 at most).
2. **Local-only app.** The app only runs on `localhost:3000`, so creators can only connect on this machine until the app is deployed (Phase 10) with its redirect URI added to the OAuth client.

To meet the gate:

1. Add each creator as a test user.
2. Have them connect: on this machine for now, or on the deployed app later.
3. Run `ingest catalogue`, `stats`, `mix` and `retention` for each channel.
4. Restore `MIN_VIEWS` to 500 in `.env` first.

## Retention probe

`pnpm --filter @soundcheck/scripts probe-analytics --channel UC-BHlgFbFh3V76yth-XCmlw --only retention`, Oct 7, 2026. Video IDs and titles are masked. The probe numbers videos by public views, so `video_3` here is video 1 above.

```
# Analytics probe, 2026-10-07
Channel UC-BHlgFbFh3V76yth-XCmlw: 4 uploads; data through 2026-10-03 (Pacific).
  video_1  published 2022-06-12T12:58:30Z  PT31S  386 public views
  video_2  published 2023-03-26T07:49:18Z  PT1M28S  343 public views
  video_3  published 2022-05-08T16:00:26Z  PT4M22S  314 public views
  video_4  published 2022-05-31T12:32:43Z  PT3M42S  239 public views
Primary video: video_1; second video: video_2.
Retention videos: regular video_3; short video_1.

## retention: regular video, the spec's five metrics
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,startedWatching,stoppedWatching,totalSegmentImpressions filters=video==video_3
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), startedWatching (METRIC INTEGER), stoppedWatching (METRIC INTEGER), totalSegmentImpressions (METRIC FLOAT)
  0 rows:

## retention: regular video, startedWatching alone
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=startedWatching filters=video==video_3
  ERROR. HTTP 500: An internal error has occurred.

## retention: regular video, stoppedWatching alone
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=stoppedWatching filters=video==video_3
  ERROR. HTTP 500: An internal error has occurred.

## retention: regular video, startedWatching and stoppedWatching together
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=startedWatching,stoppedWatching filters=video==video_3
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), startedWatching (METRIC INTEGER), stoppedWatching (METRIC INTEGER)
  0 rows:

## retention: regular video, all viewers
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_3
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 0.9838, min 0.13269999999999998, 0 points above 1, 3 rises over 0.02
  first 3 and last 2:
    [0.01,0.9838,0.3233,304]
    [0.02,0.8447,0.3048,261]
    [0.03,0.6926000000000001,0.29785,214]
    [0.99,0.1748,0.5649500000000001,54]
    [1,0.13269999999999998,0.54975,41]

## retention: regular video, subscribed
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_3;subscribedStatus==SUBSCRIBED
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 0.9798, min 0.20199999999999999, 0 points above 1, 2 rises over 0.02
  first 3 and last 2:
    [0.01,0.9798,0.32510000000000006,97]
    [0.02,0.8586,0.32325,85]
    [0.03,0.8283,0.3218,82]
    [0.99,0.2323,0.46505,23]
    [1,0.20199999999999999,0.4474,20]

## retention: regular video, unsubscribed
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_3;subscribedStatus==UNSUBSCRIBED
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 0.9856999999999999, min 0.1, 0 points above 1, 6 rises over 0.02
  first 3 and last 2:
    [0.01,0.9856999999999999,0.3235,207]
    [0.02,0.8381000000000001,0.29800000000000004,176]
    [0.03,0.6286,0.28969999999999996,132]
    [0.99,0.1476,0.5935,31]
    [1,0.1,0.58045,21]

## retention: regular video, organic
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_3;audienceType==ORGANIC
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 0.9838, min 0.13269999999999998, 0 points above 1, 3 rises over 0.02
  first 3 and last 2:
    [0.01,0.9838,0.5228,304]
    [0.02,0.8447,0.54875,261]
    [0.03,0.6926000000000001,0.5775,214]
    [0.99,0.1748,0.6366,54]
    [1,0.13269999999999998,0.631,41]

## retention: regular video, organic and unsubscribed combined
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_3;audienceType==ORGANIC;subscribedStatus==UNSUBSCRIBED
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 0.9856999999999999, min 0.1, 0 points above 1, 6 rises over 0.02
  first 3 and last 2:
    [0.01,0.9856999999999999,0.54475,207]
    [0.02,0.8381000000000001,0.56545,176]
    [0.03,0.6286,0.5928,132]
    [0.99,0.1476,0.621,31]
    [1,0.1,0.6194,21]

## retention: short, all viewers
  request: startDate=2022-06-12 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_1
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 1.45, min 0.5789, 52 points above 1, 0 rises over 0.02
  first 3 and last 2:
    [0.01,1.45,0.68535,551]
    [0.02,1.4288999999999998,0.67515,543]
    [0.03,1.4132,0.6651,537]
    [0.99,0.5816,0.84385,221]
    [1,0.5789,0.84335,220]

## retention: short, subscribed
  request: startDate=2022-06-12 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_1;subscribedStatus==SUBSCRIBED
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  100 points, elapsedVideoTimeRatio 0.01..1; audienceWatchRatio max 1.5946, min 0.7297, 70 points above 1, 0 rises over 0.02
  first 3 and last 2:
    [0.01,1.5946,0.7705,118]
    [0.02,1.5541,0.78285,115]
    [0.03,1.5405000000000002,0.79455,114]
    [0.99,0.7432,0.9097500000000001,55]
    [1,0.7297,0.9099,54]

## retention: two videos in one call (docs say unsupported)
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=elapsedVideoTimeRatio metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions filters=video==video_1,video_2
  OK. columns: elapsedVideoTimeRatio (DIMENSION FLOAT), audienceWatchRatio (METRIC FLOAT), relativeRetentionPerformance (METRIC FLOAT), totalSegmentImpressions (METRIC FLOAT)
  0 rows:

12 Analytics queries; 2 Data API units.
```

What the probe settled:

- Curves cover elapsed ratios 0.01 to 1.00 in 100 points, for every slice, including `audienceType` and `subscribedStatus` together.
- A multi-video filter and the spec's five-metric set both return an empty table rather than an error. An empty response is only a reliable sign of too few views once those two cases are avoided.
- `totalSegmentImpressions` is FLOAT.
- `relativeRetentionPerformance` differs between `all` and `organic` even when the watch ratio is identical (0.32 vs 0.52 at bin 1 here). The documentation does not explain this; treat it as a per-slice comparison and do not mix it across audiences.
- Recent windows (last 90 or 365 days) returned no rows for a 314-view video whose whole lifetime gives 100 points. YouTube needs a minimum number of views in the range, so lifetime ranges are used.

## Incidents

- **Silent empty reports.** The first probe asked for the spec's five metrics and got 0 rows for every video and slice, with no error. Testing metric by metric found that `startedWatching` and `stoppedWatching` cause it. Their 500s then retried six times each, about 2 minutes per call, until the probe and the segment call were given 2 attempts.
- **A test expectation got the Pacific date wrong.** 07:49 UTC on Mar 26, 2023 is already Mar 26 in PDT. The code was right; the test now seeds a time that crosses midnight.
- **A one-line edit missed a multi-line array** in the CLI test after Prettier reflowed it; it was redone with a pattern match. No effect on the code.

## Notes for later phases

- **Labels for Phase 08:**
  - `retention_curves.s_mono` and `hazard` are the primary labels;
  - `retention_coverage` says which curves are `complete`;
  - read them only for videos and audiences with complete curves.
- **`stoppedWatching` fallback.** It may never exist. Check `retention_coverage.details.segment_counts` across recruited channels before relying on it.
- **Shorts and the 88-second video** start with watch ratios of 1.35 to 1.6, so their early hazards are 0. Bin 1 hazard (packaging) is only informative for videos whose ratio starts below 1. Phase 07/08 should model or filter by `videos.content_type` and duration.
- **`rewatch_mass` and `rewatch_bumps`** are outcomes: fine for the UI, never model features (rule 8).
- **The organic slice** is measured only for videos where ads bring more than 2% of views, so expect it to be sparse.
- **API cost:** about 2 Analytics calls per eligible video and audience (the curve plus segment counts), about 6 per video. At five at a time, a 500-video channel takes roughly 3,000 calls.
- **Phase 10 order:** `ingest catalogue`, then `stats`, then `mix`, then `retention`, as one task per channel.
