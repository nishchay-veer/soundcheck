# YouTube fixtures

Response bodies from the YouTube Data API v3 and the YouTube Analytics API v2, used by parser and pipeline tests.

Recorded from a real connected channel with `pnpm --filter @soundcheck/scripts record-fixtures <CHANNEL_ID>` (Oct 6, 2026). Every field and value type is exactly as Google sent it; IDs (including those base64-encoded in playlist item IDs), titles, descriptions, tags, URLs, etags, dates and Data API counts are replaced with fixture values, so no real channel is identifiable. Analytics metrics and video durations are kept as recorded.

Note that Analytics returns `creatorContentType` in camelCase (`videoOnDemand`, `shorts`), not the documented `VIDEO_ON_DEMAND`.

| File                              | Call                                                                                                                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `channels.list.mine.json`         | `channels.list(part=snippet,statistics,contentDetails, mine=true)`                                                                                                                         |
| `playlistItems.list.uploads.json` | `playlistItems.list(part=snippet,contentDetails, playlistId=<uploads>, maxResults=5)`                                                                                                      |
| `videos.list.uploads.json`        | `videos.list(part=snippet,contentDetails,statistics,status,liveStreamingDetails, id=<the uploads>)`                                                                                        |
| `reports.query.content-type.json` | `reports.query(dimensions=video,creatorContentType, metrics=views, filters=video==<the uploads>)` from the oldest upload's publish date to three days ago                                  |
| `reports.query.stats.json`        | `reports.query(dimensions=video,subscribedStatus, metrics=views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage, filters=video==<the uploads>)`, same range |
| `reports.query.traffic.json`      | `reports.query(dimensions=video,insightTrafficSourceType,subscribedStatus, metrics=views,engagedViews,estimatedMinutesWatched, filters=video==<the uploads>)`, same range                  |
| `reports.query.device.json`       | `reports.query(dimensions=video,deviceType,subscribedStatus, metrics=views,engagedViews,estimatedMinutesWatched, filters=video==<the uploads>)`, same range                                |

Edge cases the recording does not contain (hidden subscriber counts, private videos, accounts without a channel) are built inline in the tests.
