# Phase 03 — Catalogue and audience mix

**Goal.** For a connected channel, land the full video catalogue and each video's audience composition in BigQuery: subscriber vs non-subscriber stats, traffic-source mix and device mix, each split by subscribed status. Every raw response is archived before parsing.

**Depends on.** Phase 02. Day: Oct 3 (morning).

## Stack

- The single-API Google packages rather than all of `googleapis`: `@googleapis/youtube` (Data API v3), `@googleapis/youtubeanalytics` (`reports.query` v2) and `@googleapis/youtubereporting` (reach report jobs), authenticated with `credentialsForChannel()` from Phase 02
- A small ISO 8601 duration parser in `packages/core` (tested); no `tinyduration`
- `@google-cloud/storage` for raw archival; `@google-cloud/bigquery` load jobs from NDJSON
- `withRetry` on every call. Calls run one after another; at 25 videos per query a channel needs only a few, so no p-limit

## Build

1. **Probe first.** `scripts/probe-analytics.ts --channel UC...` runs one query of each kind below, plus fallback shapes, for one or two videos and prints the column headers and first rows (video IDs masked). Run it on a real channel before writing parsers. Also read the [revision history](https://developers.google.com/youtube/reporting/revision_history) for the Aug 27, 2026 view-counting change and record anything relevant in the notes. Finding: a `video==` filter may list several videos when `video` is also a dimension, for every report below; the documentation does not say so.
2. `apps/pipeline/src/commands/ingest/catalogue.ts`:
   - Page `playlistItems.list` on the uploads playlist (`maxResults=50`), then `videos.list` in batches of 50 with `part=snippet,contentDetails,statistics,status,liveStreamingDetails`.
   - Label content type with `dimensions=video,creatorContentType`, `metrics=views` and a multi-video `video==` filter, 25 videos per query. (The top-videos shape with `sort=-views` and `maxResults=200` returns HTTP 400.) The API returns camelCase values (`videoOnDemand`, `shorts`), not the documented `VIDEO_ON_DEMAND`; they are converted to the documented form. A video with no views in the range has no content type.
   - Make sure the channel has Reporting API jobs for `channel_reach_basic_a1` and `channel_reach_combined_a1`, creating the missing ones (see the gotcha below). Best effort: a failure is logged and the catalogue still succeeds.
3. Eligibility, stored as `eligible` and `exclusion_reason`: content type is video on demand, Short or live stream; duration between 60 s and 3 h; published at least 7 days ago; lifetime views at least `MIN_VIEWS` (500 by default). The stored reason is the first rule failed, in this order: `too_recent`, `unsupported_content_type`, `too_short`, `too_long`, `too_few_views`, `content_type_unknown`.
4. `apps/pipeline/src/commands/ingest/stats.ts`, for eligible videos: `reports.query` with `ids=channel==MINE`, `startDate` = the earliest publish date in the batch (Pacific time), `endDate` = today minus 3 days in Pacific time (data lag), `metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage`, `dimensions=video,subscribedStatus`, `filters=video==id1,id2,...` (batch 25 at a time). Every eligible video gets a subscribed and an unsubscribed row; a slice Analytics leaves out is stored as zero views with null averages.
5. `apps/pipeline/src/commands/ingest/mix.ts`, for eligible videos, both with `dimensions=video,<dim>,subscribedStatus`, `metrics=views,engagedViews,estimatedMinutesWatched` and multi-video filters:
   - Traffic source: `insightTrafficSourceType`. This report errors when the number of videos multiplied by days in range exceeds 50,000, so compute the batch size as `floor(50000 / days_in_range)`, minimum 1, maximum 25.
   - Device: `deviceType`, 25 videos per query.
   - Map traffic types to buckets (confirm enum names against the dimensions reference): `search` = `YT_SEARCH`; `suggested` = `RELATED_VIDEO`, `END_SCREEN`; `browse` = `SUBSCRIBER`, `NOTIFICATION`, `YT_CHANNEL`, `PLAYLIST`; `external` = `EXT_URL`, `NO_LINK_EMBEDDED`, `NO_LINK_OTHER`; `other` = everything else. Devices: `mobile` = `MOBILE`, `TABLET`; `tv` = `TV`, `GAME_CONSOLE`; `desktop` = `DESKTOP`; `other` = the rest.
   - Values the API has added since are `other` too: traffic `SHORTS`, `HASHTAGS`, `YT_OTHER_PAGE`, `ADVERTISING` and others; devices `AUTOMOTIVE`, `WEARABLE`, `UNKNOWN_PLATFORM`.
   - Store raw type, bucket, views, engaged views and share (views divided by that video's total for that subscribed status). Zero-view types are dropped, and a slice with no views has no rows.
6. Raw archival: every response is written to `gs://{project}-raw/{channel_id}/{source}/{key}/{yyyymmdd}.json` before parsing, with the request parameters as object metadata. `{key}` is `page-NNN` or `batch-NNN` (or `create-{reportType}`), and the date is the UTC fetch date. Parsers are pure functions from response dict to an array of zod-validated rows.
7. Loading: write NDJSON to `gs://{project}-raw/{channel_id}/staging/`, load it into a staging table with the target's schema, then delete the channel's rows and insert the new ones in one transaction. A re-run replaces the channel's rows, so each table holds one snapshot per channel; the dated raw files keep the history. `video_stats` and both mix tables also store `engaged_views` (migration `infra/bigquery/migrations/001-engaged-views.sql`).
8. Progress: update `channels/{id}.build.progress` with `{stage: "ingest", done, total}` through a throttled writer (at most one write per 5 s) in `packages/core`.
9. CLI: `soundcheck ingest catalogue|stats|mix --channel UC... [--force]`. Each step records `channels/{id}/steps/{step}` with its data date and `INGEST_VERSION`; a re-run for the same date and version skips the step unless `--force`. Stats and mix refuse to run before the catalogue.
10. Tests: parsers against recorded fixtures for every report, eligibility rules, batch-size calculation, bucket mapping.

## Decisions and gotchas

- Analytics data lags 48 to 72 hours and the API quietly cuts off a later end date, so `endDate` is three days back; it must also be at or after `startDate`. Analytics dates are Pacific time.
- Low-view videos return empty rows. Treat absence as zero views for that slice, never as an error.
- Data API quota is 10,000 units a day; list calls cost 1 unit each, so a 500-video channel costs about 20 units. Log Analytics query counts per run.
- Also start YouTube Reporting API jobs for the channel's reach reports today (see Phase 16): `channel_reach_basic_a1` and `channel_reach_combined_a1`. Reports only accrue from a job's creation, take up to 48 hours to appear, and packaging depends on them.
- Since Aug 27, 2026 a view counts from the first frame (autoplay and hover included); `engagedViews` keeps the earlier meaning, so it is stored alongside `views`.

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
