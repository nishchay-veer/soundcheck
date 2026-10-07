# Phase 04 — Retention curves

**Goal.** For every eligible video, the measured retention curve for each measurable audience, stored as a 100-point series with a derived monotone survival curve and per-bin hazard. A coverage report tells you whether each channel is usable.

**Depends on.** Phase 03. Day: Oct 3 (afternoon).

## Stack

- `@googleapis/youtubeanalytics`: `reports.query` v2, audience retention report
- p-limit (concurrency 5) and `withRetry`
- fast-check for property tests

## Build

1. `apps/pipeline/src/commands/ingest/retention.ts`. For each eligible video and each slice in `AUDIENCE_SLICES`, call `reports.query` with `ids=channel==MINE`, `dimensions=elapsedVideoTimeRatio`, `metrics=audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions`, `startDate` = publish date (Pacific), `endDate` = today minus 3 days (Pacific, as in Phase 03), and `filters` = `video==ID` plus the slice filter joined with `;`. When the curve has data, ask for `startedWatching,stoppedWatching` in a second call and store them if they come back. (The probe found that adding either to the curve's metrics makes the report return no rows, and on the test channel each alone returns HTTP 500.) The step refuses to run before catalogue, stats and mix.
   - `all`: no extra filter
   - `subscribed`: `subscribedStatus==SUBSCRIBED`
   - `unsubscribed`: `subscribedStatus==UNSUBSCRIBED`
   - `organic`: `audienceType==ORGANIC`, only when ad views exceed 2% of the video's views; otherwise skip and note it. Ad views are the `ADVERTISING` traffic source in Phase 03's `video_traffic_mix`; no report gives views by `audienceType`.
2. The retention report accepts exactly one video ID per call ([channel reports](https://developers.google.com/youtube/analytics/channel_reports)); a multi-video filter returns no rows. Run calls through p-limit with concurrency 5 with `withRetry` backoff on 429 and quota errors. The optional segment-count call gets two attempts, so a persistent error cannot stall the run; a failed curve call fails the step.
3. Validate each curve: expect 100 points at elapsed ratios 0.01 to 1.00 (bins 1 to 100). Store what arrives, never filled in, and set `complete = (points == 100)`. Record rewatch bumps (any point higher than the previous by more than 0.02).
4. Derive per curve, in TypeScript at ingest time, and store alongside the raw values:
   - `s_mono[i]` = running minimum of `audienceWatchRatio` up to bin i, capped at 1 (removes rewatch bumps and Shorts loops; survival starts at 1 and can only fall).
   - `hazard[1]` = `1 - s_mono[1]`, taking survival at time zero as 1.
   - `hazard[i]` = `1 - s_mono[i] / s_mono[i-1]` for i from 2 to 100, clipped to \[0, 0.999\]; 0 once survival has reached 0 (nobody is left to leave).
   - `rewatch_mass` per video and audience = sum of `max(0, audienceWatchRatio[i] - s_mono[i])`. This is an outcome. It may be shown in the UI; it must never become a model feature.
5. Coverage: write `retention_coverage` rows `(channel_id, video_id, audience, status, points, rewatch_bumps, rewatch_mass, details)` where status is `complete`, `partial`, `insufficient_data` (empty response because of too few views) or `skipped` (organic below the ad threshold, with the reason in `details`). `details.segment_counts` says whether the segment counts were `available`, `empty`, `error` (with the message) or `not_requested`. The three new columns come from `infra/bigquery/migrations/002-retention-coverage.sql`.
6. CLI `soundcheck ingest retention --channel UC... [--force]` ends by printing a coverage table: eligible videos; videos with complete subscribed and unsubscribed curves; median views; total API calls; whether the channel is usable for modeling; counts per audience and status; segment-count availability.
7. Tests: parser on fixtures; hazard derivation on hand-made curves; a fast-check property test that rebuilding survival from hazards reproduces `s_mono` within 1e-9 (for curves whose survival stays above 0, so clipping never applies); a curve with a rewatch bump produces non-negative hazards.

## Decisions and gotchas

- Bin 1 hazard mixes content with packaging: people who clicked and left immediately often reacted to the title or thumbnail. Keep it, and flag it with a feature in Phase 07.
- `stoppedWatching` is stored too, whenever YouTube returns it. Phase 08 uses `s_mono`-derived hazards as the primary label; `stoppedWatching` is the fallback if derived hazards turn out noisy. On the Phase 04 test channel YouTube never returned it, so the fallback may not exist.
- Shorts loop, so their watch ratio sits above 1 for much of the video; with survival capped at 1 their early hazards are 0. Phase 07/08 should model or filter them by `videos.content_type`.
- A channel is usable for modeling when at least 40 videos have complete subscribed and unsubscribed curves. Smaller channels get descriptive analytics only.

## Do not

- Average curves across audiences to fill gaps. Missing is missing.

## Done when

- [ ] Coverage report run on every recruited channel and pasted into the notes
- [ ] At least two channels meet the 40-video bar (this is the data gate input)
- [ ] Hazard reconstruction property test passes
- [ ] Total API calls per channel logged
- [ ] `docs/notes/phase-04.md` written
