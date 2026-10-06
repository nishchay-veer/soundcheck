# YouTube fixtures

Response bodies from the YouTube Data API v3, used by parser and data-function tests.

| File                      | Call                                                               | Source                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `channels.list.mine.json` | `channels.list(part=snippet,statistics,contentDetails, mine=true)` | Hand-written from the documented response shape (Phase 02, part 2); replace with a recorded response after the first real sign-in |
