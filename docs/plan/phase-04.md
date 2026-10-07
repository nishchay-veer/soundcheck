# Phase 04 — Retention curves

**Goal.** For every eligible video, the measured retention curve for each measurable audience, stored as a 100-point series with a derived monotone survival curve and per-bin hazard. A coverage report tells you whether each channel is usable.

**Depends on.** Phase 03. Day: Oct 3 (afternoon).

## Stack

- `googleapis`: `youtubeAnalytics("v2").reports.query`, audience retention report
- p-limit (concurrency 5) and `withRetry`
- fast-check for property tests

## Build

1. `apps/pipeline/src/commands/ingest/retention.ts`. For each eligible video and each slice in `AUDIENCE_SLICES`, call `reports.query` with `ids=channel==MINE`, `dimensions=elapsedVideoTimeRatio`, `metrics=audienceWatchRatio,relativeRetentionPerformance,startedWatching,stoppedWatching,totalSegmentImpressions`, `startDate` = publish date, `endDate` = today minus 2 days, and `filters` = `video==ID` plus the slice filter joined with `;`.
   - `all`: no extra filter
   - `subscribed`: `subscribedStatus==SUBSCRIBED`
   - `unsubscribed`: `subscribedStatus==UNSUBSCRIBED`
   - `organic`: `audienceType==ORGANIC`, only when ad views exceed 2% of the video's views; otherwise skip and note it
2. The retention report accepts exactly one video ID per call ([channel reports](https://developers.google.com/youtube/analytics/channel_reports)). Run calls through p-limit with concurrency 5 with `withRetry` backoff on 429 and quota errors.
3. Validate each curve: expect 100 points at elapsed ratios 0.01 to 1.00. Store what arrives and set `complete = (points == 100)`. Record rewatch bumps (any point higher than the previous by more than 0.02).
4. Derive per curve, in TypeScript at ingest time, and store alongside the raw values:
   - `s_mono[i]` = running minimum of `audienceWatchRatio` up to bin i (removes rewatch bumps; survival can only fall).
   - `hazard[1]` = `1 - s_mono[1]`, taking survival at time zero as 1.
   - `hazard[i]` = `1 - s_mono[i] / s_mono[i-1]` for i from 2 to 100, clipped to \[0, 0.999\].
   - `rewatch_mass` per video = sum of `max(0, audienceWatchRatio[i] - s_mono[i])`. This is an outcome. It may be shown in the UI; it must never become a model feature.
5. Coverage: write `retention_coverage` rows `(channel_id, video_id, audience, status, points)` where status is `complete`, `partial` or `insufficient_data` (empty response because of too few views).
6. CLI `soundcheck ingest retention --channel UC...` ends by printing a coverage table: eligible videos; videos with complete subscribed and unsubscribed curves; median views; total API calls.
7. Tests: parser on fixtures; hazard derivation on hand-made curves; a fast-check property test that rebuilding survival from hazards reproduces `s_mono` within 1e-9; a curve with a rewatch bump produces non-negative hazards.

## Decisions and gotchas

- Bin 1 hazard mixes content with packaging: people who clicked and left immediately often reacted to the title or thumbnail. Keep it, and flag it with a feature in Phase 07.
- `stoppedWatching` is stored too. Phase 08 uses `s_mono`-derived hazards as the primary label; `stoppedWatching` is the fallback if derived hazards turn out noisy.
- A channel is usable for modeling when at least 40 videos have complete subscribed and unsubscribed curves. Smaller channels get descriptive analytics only.

## Do not

- Average curves across audiences to fill gaps. Missing is missing.

## Done when

- [ ] Coverage report run on every recruited channel and pasted into the notes
- [ ] At least two channels meet the 40-video bar (this is the data gate input)
- [ ] Hazard reconstruction property test passes
- [ ] Total API calls per channel logged
- [ ] `docs/notes/phase-04.md` written
