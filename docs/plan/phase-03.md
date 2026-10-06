# Phase 03 — Catalogue and audience mix

**Goal.** For a connected channel, land the full video catalogue and each video's audience composition in BigQuery: subscriber vs non-subscriber stats, traffic-source mix and device mix, each split by subscribed status. Every raw response is archived before parsing.

**Depends on.** Phase 02. Day: Oct 3 (morning).

## Stack

- `googleapis`: `youtube("v3")` and `youtubeAnalytics("v2").reports.query`, authenticated with `credentialsForChannel()` from Phase 02
- A small ISO 8601 duration parser in `packages/core` (tested), or the `tinyduration` package
- `@google-cloud/storage` for raw archival; `@google-cloud/bigquery` load jobs from NDJSON
- `withRetry` and p-limit

## Build

1. **Probe first.** `scripts/probe-analytics.ts --channel UC...` runs one query of each kind below for one video and prints the column headers and first rows. Run it on a real channel before writing parsers. Also read the [revision history](https://developers.google.com/youtube/reporting/revision_history) for the Aug 27, 2026 view-counting change and record anything relevant in the notes.
2. `apps/pipeline/src/commands/ingest/catalogue.ts`:
   - Page `playlistItems.list` on the uploads playlist (`maxResults=50`), then `videos.list` in batches of 50 with `part=snippet,contentDetails,statistics,status,liveStreamingDetails`.
   - Label content type with the Analytics top-videos report: `dimensions=video,creatorContentType`, `metrics=views`, `sort=-views`, `maxResults=200`, paginated with `startIndex`. Values include video-on-demand, Shorts and live streams; confirm exact enum strings in the [dimensions reference](https://developers.google.com/youtube/analytics/dimensions).
3. Eligibility, stored as `eligible` and `exclusion_reason`: content type is video-on-demand; duration between 120 s and 3 h; published at least 7 days ago; lifetime views at least `MIN_VIEWS` (500 by default).
4. `apps/pipeline/src/commands/ingest/stats.ts`: `reports.query` with `ids=channel==MINE`, `startDate` = publish date, `endDate` = today minus 2 days (data lag), `metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage`, `dimensions=video,subscribedStatus`, `filters=video==id1,id2,...` (the basic-stats report accepts several video IDs; batch 25 at a time).
5. `apps/pipeline/src/commands/ingest/mix.ts`, both with `dimensions=video,<dim>,subscribedStatus` and multi-video filters:
   - Traffic source: `insightTrafficSourceType`, `metrics=views,estimatedMinutesWatched`. This report errors when the number of videos multiplied by days in range exceeds 50,000, so compute the batch size as `floor(50000 / days_in_range)`, minimum 1.
   - Device: `deviceType`, `metrics=views,estimatedMinutesWatched`.
   - Map traffic types to buckets (confirm enum names against the dimensions reference): `search` = `YT_SEARCH`; `suggested` = `RELATED_VIDEO`, `END_SCREEN`; `browse` = `SUBSCRIBER`, `NOTIFICATION`, `YT_CHANNEL`, `PLAYLIST`; `external` = `EXT_URL`, `NO_LINK_EMBEDDED`, `NO_LINK_OTHER`; `other` = everything else. Devices: `mobile` = `MOBILE`, `TABLET`; `tv` = `TV`, `GAME_CONSOLE`; `desktop` = `DESKTOP`; `other` = the rest.
   - Store raw type, bucket, views and share (views divided by that video's total for that subscribed status).
6. Raw archival: every response is written to `gs://{project}-raw/{channel_id}/{source}/{key}/{yyyymmdd}.json` before parsing. Parsers are pure functions from response dict to an array of zod-validated rows.
7. Loading: write NDJSON to a staging prefix, then a BigQuery load job. Idempotency: delete rows for `(channel_id, as_of)` before loading in a single script, or use `MERGE` from a staging table.
8. Progress: update `channels/{id}.build.progress` with `{stage: "ingest", done, total}` through a throttled writer (at most one write per 5 s) in `packages/core`.
9. CLI: `soundcheck ingest catalogue --channel UC...` and `ingest mix --channel UC...`.
10. Tests: parsers against recorded fixtures for every report, eligibility rules, batch-size calculation, bucket mapping.

## Decisions and gotchas

- Analytics data lags about two days; `endDate` must not be in the future and must be at or after `startDate`.
- Low-view videos return empty rows. Treat absence as zero views for that slice, never as an error.
- Data API quota is 10,000 units a day; list calls cost 1 unit each, so a 500-video channel costs about 20 units. Log Analytics query counts per run.
- Also start a YouTube Reporting API job for the channel's reach report today (see Phase 16). Reports take up to 48 hours to appear, and packaging depends on them.

## Do not

- Fetch retention curves (Phase 04).
- Download any video file. It violates YouTube's terms, and the design does not need it.

## Done when

- [ ] Probe output for a real channel is pasted into the notes
- [ ] `videos`, `video_stats`, `video_traffic_mix`, `video_device_mix` populated for at least one real channel
- [ ] Every eligible video has subscribed and unsubscribed stats rows, or a recorded reason why not
- [ ] Mix shares sum to 1 (within 0.01) per video and subscribed status
- [ ] A re-run produces no duplicate rows
- [ ] `docs/notes/phase-03.md` written
