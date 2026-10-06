# Phase 03: Catalogue and audience mix

Oct 6, 2026 · **In progress: parts 1–4 of 7 committed.** This file is the handoff; it becomes the final phase note in part 7.

For a connected channel, Soundcheck now lands the video catalogue (with content type and training eligibility) and per-video subscriber and non-subscriber stats in BigQuery. Every raw API response is archived to GCS before it is parsed. The traffic-source and device mix is next.

## Progress

| Part                           | Commit                                                                 | Status |
| ------------------------------ | ---------------------------------------------------------------------- | ------ |
| 1. Analytics probe             | `ff191d0` Add an Analytics probe for the ingest reports                | Done   |
| 2. Job building blocks         | `e786c32` Add raw archiving, BigQuery replace loads and build progress | Done   |
| 3. Catalogue                   | `2c21ae8` Ingest the video catalogue with content type and eligibility | Done   |
| 4. Stats                       | `a8928dd` Ingest subscriber and newcomer stats for eligible videos     | Done   |
| 5. Mix                         | `Ingest traffic-source and device mix for eligible videos`             | Next   |
| 6. Reach report jobs           | `Start reach report jobs when a channel is ingested`                   | To do  |
| 7. Live verification and notes | `Verify Phase 03 live and write the notes`                             | To do  |

## Resume here

### Part 5: `soundcheck ingest mix --channel UC… [--force]`

- **Queries** (shapes confirmed by the probe below): `dimensions=video,insightTrafficSourceType,subscribedStatus` and `dimensions=video,deviceType,subscribedStatus`. Both use `metrics=views,engagedViews,estimatedMinutesWatched` and a multi-video `video==` filter.
- **Batches:** use `videoBatches(videos, asOf, maxSize)` from core.
  - Traffic: `maxSize(days) = min(25, floor(50000 / days))`, at least 1. The traffic report errors when videos × days exceeds 50,000.
  - Device: 25.
- **Rows** go to `video_traffic_mix` and `video_device_mix`: `raw_type`, `bucket`, `views`, `engaged_views`, `share`, `as_of`.
  - `share` = views ÷ that video's total for that subscribed status.
  - A video and status with a total of zero gets no rows.
  - Rows with zero views do appear in Analytics output.
- **Traffic buckets:**

  | Bucket      | Types                                                          |
  | ----------- | -------------------------------------------------------------- |
  | `search`    | `YT_SEARCH`                                                    |
  | `suggested` | `RELATED_VIDEO`, `END_SCREEN`                                  |
  | `browse`    | `SUBSCRIBER`, `NOTIFICATION`, `YT_CHANNEL`, `PLAYLIST`         |
  | `external`  | `EXT_URL`, `NO_LINK_EMBEDDED`, `NO_LINK_OTHER`                 |
  | `other`     | everything else, including `SHORTS`, `HASHTAGS`, `ADVERTISING` |

- **Device buckets:**

  | Bucket    | Types                                                                   |
  | --------- | ----------------------------------------------------------------------- |
  | `mobile`  | `MOBILE`, `TABLET`                                                      |
  | `tv`      | `TV`, `GAME_CONSOLE`                                                    |
  | `desktop` | `DESKTOP`                                                               |
  | `other`   | everything else, including `AUTOMOTIVE`, `WEARABLE`, `UNKNOWN_PLATFORM` |

- **Reuse:**
  - `catalogueVideos(run)` for the eligible videos;
  - `run.report(source, key, query)` for fetching and archiving (sources `analytics-traffic` and `analytics-device`);
  - `replaceChannelRows` for loading.
  - Add the parsers and queries to `packages/core/src/youtube/reports.ts`, and the row schemas to `schemas/bigquery.ts`.
- **Tests:**
  - Record `reports.query.traffic.json` and `reports.query.device.json` with `scripts/record-fixtures.ts`, then scan them for real IDs and titles.
  - Add both tables to `COLUMNS` and both dimensions to `reportFixture` in `apps/pipeline/src/commands/ingest/testbed.ts`.
  - Cover the bucket mapping, batch sizes, and the property that shares sum to 1 within 0.01.

### Part 6: reach report jobs

- Add `@googleapis/youtubereporting` 11.0.1 (approved in decision A).
- During `ingest catalogue`, list the channel's Reporting API jobs and create `channel_reach_basic_a1` and `channel_reach_combined_a1` if missing. Log the job IDs.
- Reports only accrue from creation onward and take up to 48 hours. Phase 16 packaging reads them.

### Part 7: verify and finish

1. Run catalogue, stats and mix live, then re-run each with `--force`.
2. Check with SQL:
   - no duplicate rows in any of the four tables;
   - every eligible video has both stats rows;
   - mix shares sum to 1 within 0.01 per video and status.
3. Record the spec changes below in `docs/plan/phase-03.md`.
4. Finish this note and the STATUS entry.

## Done when

| Item                                                                                          | Status                                                                                                                                   |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Probe output for a real channel is pasted into the notes                                      | Done (below)                                                                                                                             |
| `videos`, `video_stats`, `video_traffic_mix`, `video_device_mix` populated for a real channel | `videos` and `video_stats` done; the mix tables need part 5                                                                              |
| Every eligible video has subscribed and unsubscribed stats rows, or a recorded reason         | Done: 3 eligible videos, 6 rows, and SQL finds 0 eligible videos missing either row. Missing slices are filled with zero views by design |
| Mix shares sum to 1 (within 0.01) per video and subscribed status                             | Part 5                                                                                                                                   |
| A re-run produces no duplicate rows                                                           | Done for `videos` (4 rows, 4 distinct after a forced re-run) and `video_stats`; mix in part 7                                            |
| `docs/notes/phase-03.md` written                                                              | In progress (this file)                                                                                                                  |

## Decisions

Approved at planning:

- **A.** `@googleapis/youtubeanalytics` and `@googleapis/youtubereporting` (11.0.1) instead of `googleapis`. The ISO 8601 duration parser is our own; no `tinyduration`.
- **B.** A re-run replaces the channel's rows in each table in one transaction, so there is one snapshot per channel. Dated raw files in GCS keep the history.
- **C.** Store `engaged_views` next to `views` in `video_stats` and both mix tables. Shares still use `views`.

Made during the build (by Nishchay):

- **Eligibility** accepts videos on demand, Shorts and live streams, from 60 s to 3 h. Videos must be at least 7 days old with at least `MIN_VIEWS` views. Stories, `UNSPECIFIED` and unknown types are excluded.
- **`MIN_VIEWS=200`** is set in the local `.env` only, for testing on a small channel. The code default stays 500.

## Changes from the spec (so far)

To be copied into `docs/plan/phase-03.md` in part 7.

- **Content type query.** The spec's top-videos shape (`dimensions=video,creatorContentType`, `sort=-views`, `maxResults=200`) returns HTTP 400. Content type is read with a multi-video `video==` filter instead, 25 per query.
- **Content type values** come back in camelCase (`videoOnDemand`, `shorts`), not the documented `VIDEO_ON_DEMAND`. They are converted to the documented form. A filter with the uppercase value is rejected.
- **End date** is today minus 3 days in Pacific time, not minus 2. Data lags 48 to 72 hours and later dates are silently cut off.
- **Eligibility**, as decided above. The exclusion reasons are:
  - `too_recent`
  - `unsupported_content_type`
  - `too_short`
  - `too_long`
  - `too_few_views`
  - `content_type_unknown`

  They are checked in that order, so the stored reason is the most informative one.

- **Extra `ingest stats` subcommand.** Stats and mix cover eligible videos only. Each batch starts at its oldest video's publish date (Pacific); the totals are the same as with per-video start dates.
- **Rule 7 skipping.** A step marker at `channels/{id}/steps/{step}` holds `{asOf, version, rows, finishedAt}`. A re-run for the same data date and `INGEST_VERSION` skips the step; `--force` redoes it.
- **Loading.** NDJSON goes to `gs://…-raw/{channel}/staging/{table}/{runId}.ndjson`, then a load job fills a staging table, then one transaction deletes the channel's rows and inserts the new ones. Nothing is streamed.
- **Raw archive keys:**
  - `youtube-playlist-items/page-NNN`
  - `youtube-videos/batch-NNN`
  - `analytics-content-type/batch-NNN`
  - `analytics-stats/batch-NNN`

  The request parameters are stored as object metadata.

- **Schema.** `engaged_views` comes from `infra/bigquery/migrations/001-engaged-views.sql` (applied). `03-bigquery.sh` now applies migrations.

## The Aug 27, 2026 view-counting change

From the [revision history](https://developers.google.com/youtube/reporting/revision_history):

- YouTube now counts a public **view** "the moment a video begins to play", for every format: long-form, live and Shorts. That includes autoplay, hover and click or tap.
- **`engagedViews`** is unchanged: views past the first frame, or a click or tap to play.
- Thumbnail impressions are unchanged, and monetisation stays based on engaged metrics.
- The metrics reference does not say whether the change applies to dates before Aug 27. Treat `views` as having two meanings across that date.

Effects here:

- **`MIN_VIEWS`** compares against the public count, which now counts more views.
- **Analytics `views`** is inflated for days after Aug 27, most for Home and browse autoplay. Mix shares use `views` per the spec.
- **`engaged_views`** is stored so later phases can switch. On the test channel it is within 1–3 of `views` on every row.

The same page also lists:

- **Sep 9, 2026:** documented the 48–72 hour processing delay and the end-date truncation. An unsupported dimension, metric or filter combination returns HTTP 400 "The query is not supported".
- **Jan 15, 2026:** the Reporting API added reach reports (`channel_reach_basic_a1`, `channel_reach_combined_a1`) with `video_thumbnail_impressions` and `video_thumbnail_impressions_ctr`.

## Live results so far

Channel `UC-BHlgFbFh3V76yth-XCmlw`, data through 2026-10-03, `MIN_VIEWS=200`:

| Video (by publish date) | Length | Content type    | Eligible        | Subscribers: views, avg watched | Non-subscribers: views, avg watched |
| ----------------------- | ------ | --------------- | --------------- | ------------------------------- | ----------------------------------- |
| 1 (2022-05-08)          | 4:22   | VIDEO_ON_DEMAND | yes             | 102, 114 s (43.5%)              | 212, 88 s (33.7%)                   |
| 2 (2022-05-31)          | 3:42   | VIDEO_ON_DEMAND | yes             | 45, 75 s (34.0%)                | 194, 99 s (44.8%)                   |
| 3 (2022-06-12)          | 0:31   | SHORTS          | no: `too_short` | n/a                             | n/a                                 |
| 4 (2023-03-26)          | 1:28   | VIDEO_ON_DEMAND | yes             | 42, 60 s (68.3%)                | 300, 60 s (68.4%)                   |

- **API usage:** each ingest step used 1 Analytics query; the catalogue also used 2 Data API units.
- **Timing:** each step takes about 21 s, mostly the BigQuery load (about 10 s per replace).

## Probe output

`pnpm --filter @soundcheck/scripts probe-analytics --channel UC-BHlgFbFh3V76yth-XCmlw`, Oct 6, 2026. Video IDs and titles are masked. The probe numbers videos by public views, not by publish date as the table above does.

```
# Analytics probe, 2026-10-06
Channel UC-BHlgFbFh3V76yth-XCmlw: 4 uploads; data through 2026-10-03 (Pacific).
  video_1  published 2022-06-12T12:58:30Z  PT31S  386 public views
  video_2  published 2023-03-26T07:49:18Z  PT1M28S  342 public views
  video_3  published 2022-05-08T16:00:26Z  PT4M22S  314 public views
  video_4  published 2022-05-31T12:32:43Z  PT3M42S  239 public views
Primary video: video_1; second video: video_2.

## content type: top videos by creatorContentType (spec)
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,creatorContentType metrics=views sort=-views maxResults=200 startIndex=1
  ERROR. HTTP 400: The query is not supported. Check the documentation at https://developers.google.com/youtube/analytics/v2/available_reports for a list of supported queries.

## content type: video,creatorContentType with a multi-video filter
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,creatorContentType metrics=views filters=video==video_1,video_2,video_3,video_4
  OK. columns: video (DIMENSION STRING), creatorContentType (DIMENSION STRING), views (METRIC INTEGER)
  4 rows:
    ["video_4","videoOnDemand",239]
    ["video_3","videoOnDemand",314]
    ["video_2","videoOnDemand",342]
    ["video_1","shorts",386]

## content type: top videos filtered to one creatorContentType
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video metrics=views filters=creatorContentType==VIDEO_ON_DEMAND sort=-views maxResults=200
  ERROR. HTTP 400: Invalid value (VIDEO_ON_DEMAND) given in field parameters.filters.

## content type: one video, creatorContentType as a dimension
  request: startDate=2022-06-12 endDate=2026-10-03 dimensions=creatorContentType metrics=views filters=video==video_1
  OK. columns: creatorContentType (DIMENSION STRING), views (METRIC INTEGER)
  1 rows:
    ["shorts",386]

## stats: video,subscribedStatus with a multi-video filter (spec)
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage filters=video==video_1,video_2
  OK. columns: video (DIMENSION STRING), subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER), averageViewDuration (METRIC INTEGER), averageViewPercentage (METRIC FLOAT)
  4 rows:
    ["video_2","UNSUBSCRIBED",300,299,299,60,68.37]
    ["video_2","SUBSCRIBED",42,42,42,60,68.28]
    ["video_1","UNSUBSCRIBED",311,308,159,31,100.12999999999998]
    ["video_1","SUBSCRIBED",75,74,43,35,113.86]

## stats: top videos for subscribed viewers
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage filters=subscribedStatus==SUBSCRIBED sort=-views maxResults=200
  OK. columns: video (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER), averageViewDuration (METRIC INTEGER), averageViewPercentage (METRIC FLOAT)
  4 rows:
    ["video_3",102,102,193,114,43.53]
    ["video_1",75,74,43,35,113.86]
    ["video_4",45,45,56,75,34]
    ["video_2",42,42,42,60,68.28]

## stats: top videos with subscribedStatus as a dimension
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage sort=-views maxResults=200
  ERROR. HTTP 400: The query is not supported. Check the documentation at https://developers.google.com/youtube/analytics/v2/available_reports for a list of supported queries.
  Retrying without engagedViews:
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,subscribedStatus metrics=views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage sort=-views maxResults=200
  ERROR. HTTP 400: The query is not supported. Check the documentation at https://developers.google.com/youtube/analytics/v2/available_reports for a list of supported queries.
  Retrying without averageViewPercentage too:
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,subscribedStatus metrics=views,estimatedMinutesWatched,averageViewDuration sort=-views maxResults=200
  ERROR. HTTP 400: The query is not supported. Check the documentation at https://developers.google.com/youtube/analytics/v2/available_reports for a list of supported queries.

## stats: one video, subscribedStatus as a dimension
  request: startDate=2022-06-12 endDate=2026-10-03 dimensions=subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage filters=video==video_1
  OK. columns: subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER), averageViewDuration (METRIC INTEGER), averageViewPercentage (METRIC FLOAT)
  2 rows:
    ["SUBSCRIBED",75,74,43,35,113.86]
    ["UNSUBSCRIBED",311,308,159,31,100.12999999999998]

## stats: one video, subscribedStatus as a filter
  request: startDate=2022-06-12 endDate=2026-10-03 metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage filters=video==video_1;subscribedStatus==SUBSCRIBED
  OK. columns: views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER), averageViewDuration (METRIC INTEGER), averageViewPercentage (METRIC FLOAT)
  1 rows:
    [75,74,43,35,113.86]

## traffic: video,insightTrafficSourceType,subscribedStatus, multi-video filter (spec)
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,insightTrafficSourceType,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched filters=video==video_1,video_2
  OK. columns: video (DIMENSION STRING), insightTrafficSourceType (DIMENSION STRING), subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER)
  30 rows, first 8:
    ["video_2","NO_LINK_OTHER","UNSUBSCRIBED",8,8,6]
    ["video_2","NO_LINK_OTHER","SUBSCRIBED",0,0,0]
    ["video_2","SUBSCRIBER","UNSUBSCRIBED",29,28,24]
    ["video_2","SUBSCRIBER","SUBSCRIBED",27,27,27]
    ["video_2","YT_CHANNEL","UNSUBSCRIBED",81,81,76]
    ["video_2","YT_CHANNEL","SUBSCRIBED",6,6,6]
    ["video_2","YT_SEARCH","UNSUBSCRIBED",95,95,91]
    ["video_2","YT_SEARCH","SUBSCRIBED",8,8,6]

## traffic: one video
  request: startDate=2022-06-12 endDate=2026-10-03 dimensions=insightTrafficSourceType,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched filters=video==video_1
  OK. columns: insightTrafficSourceType (DIMENSION STRING), subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER)
  17 rows, first 8:
    ["NO_LINK_OTHER","UNSUBSCRIBED",0,0,0]
    ["NO_LINK_OTHER","SUBSCRIBED",0,0,0]
    ["SUBSCRIBER","UNSUBSCRIBED",4,4,0]
    ["SUBSCRIBER","SUBSCRIBED",30,30,15]
    ["YT_CHANNEL","UNSUBSCRIBED",185,185,118]
    ["YT_CHANNEL","SUBSCRIBED",14,14,10]
    ["YT_SEARCH","UNSUBSCRIBED",20,17,4]
    ["YT_SEARCH","SUBSCRIBED",6,5,2]

## traffic: two videos without a video dimension (combined?)
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=insightTrafficSourceType,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched filters=video==video_1,video_2
  OK. columns: insightTrafficSourceType (DIMENSION STRING), subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER)
  18 rows, first 8:
    ["NO_LINK_OTHER","UNSUBSCRIBED",8,8,6]
    ["NO_LINK_OTHER","SUBSCRIBED",0,0,0]
    ["SUBSCRIBER","UNSUBSCRIBED",33,32,25]
    ["SUBSCRIBER","SUBSCRIBED",57,57,42]
    ["YT_CHANNEL","UNSUBSCRIBED",266,266,195]
    ["YT_CHANNEL","SUBSCRIBED",20,20,17]
    ["YT_SEARCH","UNSUBSCRIBED",115,112,96]
    ["YT_SEARCH","SUBSCRIBED",14,13,8]

## device: video,deviceType,subscribedStatus, multi-video filter (spec)
  request: startDate=2022-05-08 endDate=2026-10-03 dimensions=video,deviceType,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched filters=video==video_1,video_2
  OK. columns: video (DIMENSION STRING), deviceType (DIMENSION STRING), subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER)
  14 rows, first 8:
    ["video_2","DESKTOP","UNSUBSCRIBED",108,107,111]
    ["video_2","DESKTOP","SUBSCRIBED",13,13,11]
    ["video_2","TV","UNSUBSCRIBED",2,2,0]
    ["video_2","TV","SUBSCRIBED",1,1,1]
    ["video_2","MOBILE","UNSUBSCRIBED",189,189,187]
    ["video_2","MOBILE","SUBSCRIBED",28,28,29]
    ["video_2","TABLET","UNSUBSCRIBED",1,1,0]
    ["video_1","DESKTOP","UNSUBSCRIBED",13,13,7]

## device: one video
  request: startDate=2022-06-12 endDate=2026-10-03 dimensions=deviceType,subscribedStatus metrics=views,engagedViews,estimatedMinutesWatched filters=video==video_1
  OK. columns: deviceType (DIMENSION STRING), subscribedStatus (DIMENSION STRING), views (METRIC INTEGER), engagedViews (METRIC INTEGER), estimatedMinutesWatched (METRIC INTEGER)
  7 rows:
    ["DESKTOP","UNSUBSCRIBED",13,13,7]
    ["DESKTOP","SUBSCRIBED",21,21,8]
    ["TV","UNSUBSCRIBED",1,1,0]
    ["TV","SUBSCRIBED",1,1,0]
    ["MOBILE","UNSUBSCRIBED",295,292,151]
    ["MOBILE","SUBSCRIBED",53,52,34]
    ["TABLET","UNSUBSCRIBED",2,2,0]

16 Analytics queries; 2 Data API units.
```

What the probe settled:

- A `video==` filter may list several videos when `video` is also a dimension. This works for stats, traffic, device and content type, though the docs describe only single-video or combined reports.
- Without the `video` dimension, a multi-video filter returns the videos' combined totals.
- Top-videos reports reject `subscribedStatus` as a dimension and reject `creatorContentType` alongside `sort`.
- `averageViewDuration` and `estimatedMinutesWatched` are INTEGER. `averageViewPercentage` exceeds 100 on a looping Short.

## Incidents

- **`03-bigquery.sh` stopped at the migration.**
  - Cause: `bq` read a query starting with a `--` SQL comment as a command-line flag.
  - Fix: the script now drops full-line SQL comments before calling `bq`; the re-run applied the migration.
- **Duplicate keys in log lines.**
  - Cause: the loader rebound `channel_id`, `stage` and `run_id` on a logger that already had them, and pino writes repeated keys.
  - Fix: `childLogger` skips keys the parent already binds to the same value, and the loader no longer rebinds `stage`.
- **Early staging.** While replacing `apps/pipeline/src/commands/ingest.ts` with a directory, a `git rm --cached` staged the deletion before review. It was unstaged at once and committed with part 3.

## Notes for later phases

- **Shorts and live streams are training-eligible** (Nishchay's decision). Their retention behaves differently: Shorts loop past 100%, and stream replays differ. Use `videos.content_type` to model or filter them.
- **Phase 04 retention:**
  - Read the eligible set with `eligibleVideos(channelId)` from `@soundcheck/core/jobs`.
  - Follow the ingest command pattern: `startIngest`, `run.report`, `replaceChannelRows`, `run.finish`.
- **Concurrent loads:** BigQuery may abort a transaction with "concurrent update" when two channels load the same table at once. Retry, or serialize, when Phase 10 runs channel builds in parallel.
- **Ingest runs as a single task per channel.** Replace-per-channel loads would clobber each other if one channel's step were sharded.
- **Stale raw files:** if the batching changes between two runs on the same day, an old `batch-NNN` file can remain in the raw archive. Nothing reads raw files back yet.
- **Local runs:** `pnpm --filter @soundcheck/pipeline soundcheck ingest catalogue|stats --channel UC… [--force]` now loads the repo-root `.env`.
