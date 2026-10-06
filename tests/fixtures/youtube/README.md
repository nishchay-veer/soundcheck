# YouTube fixtures

Response bodies from the YouTube Data API v3, used by parser and data-function tests.

Recorded from a real connected channel with `pnpm --filter @soundcheck/scripts record-fixtures <CHANNEL_ID>` (Oct 6, 2026). Every field and value type is exactly as Google sent it; IDs (including those base64-encoded in playlist item IDs), titles, descriptions, URLs, etags, dates and counts are replaced with fixture values, so no real channel is identifiable.

| File                              | Call                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------- |
| `channels.list.mine.json`         | `channels.list(part=snippet,statistics,contentDetails, mine=true)`                    |
| `playlistItems.list.uploads.json` | `playlistItems.list(part=snippet,contentDetails, playlistId=<uploads>, maxResults=5)` |

Edge cases the recording does not contain (hidden subscriber counts, private videos, accounts without a channel) are built inline in the tests.
