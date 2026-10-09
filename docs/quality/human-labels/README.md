# Human beat labels

Hand-written `beat_type` labels for two of the extraction quality gate's test videos (Phase 06). Gemini's labels for the same videos are compared with these second by second, which tells us whether the labels mean what a person would say they mean.

| File              | Video                                                                   |
| ----------------- | ----------------------------------------------------------------------- |
| `S9H3sqKc9Y4.csv` | Darwinbox explainer, 2:37 (https://www.youtube.com/watch?v=S9H3sqKc9Y4) |
| `RwkGSPp6yG0.csv` | Switzerland vlog, 14:55 (https://www.youtube.com/watch?v=RwkGSPp6yG0)   |

## Method

These labels were made by **reviewing Gemini's draft**, not blind: `soundcheck consistency human --draft` wrote Gemini's beats (current prompt, temperature 0) into each `{videoId}.csv` and kept the untouched draft as `{videoId}.draft.csv`. Nishchay watched each video and corrected the rows that were wrong. Agreement measured this way is biased upward, since a reviewer tends to keep what is shown; the comparison reports how many beats were changed so the bias is visible. To label independently instead, delete the `.draft.csv` files and write the CSVs from scratch without looking at Gemini's output.

## How to label

Watch the video and write one row per beat: a span with one purpose. Beats run back to back from `0:00` to the end, with no gaps or overlaps.

```
start,end,beat_type
0:00,0:23,context
0:23,0:44,setup
```

- Times are `M:SS` (minutes may go past 59). Each row's `start` is the previous row's `end`.
- Most beats last 8 to 90 seconds. Start a new beat when the purpose changes.
- Label what you see and hear, not what the title says. Do not look at Gemini's output first.

## Beat types

The same definitions Gemini is given (`packages/core/src/prompts/extract-beats.ts`):

| Type             | Meaning                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------- |
| `cold_open`      | Starts mid-action, before any introduction                                               |
| `hook`           | A tease or promise in the opening seconds (usually the first 30)                         |
| `intro_branding` | Channel intro, logo or theme music                                                       |
| `setup`          | What this video will do and with what: agenda, tools, introducing the speaker or product |
| `context`        | Background that is not this video's plan: the problem, history, situation                |
| `explanation`    | Telling how or why, while the picture mostly shows the speaker, slides or diagrams       |
| `demonstration`  | The picture shows the thing being done or used; a narrated app or product walkthrough    |
| `example`        | A specific case illustrating a point just made                                           |
| `story`          | Events told in order: what happened, a journey; a narrated vlog day                      |
| `opinion`        | The creator judges or recommends: pros and cons, a rating, "I think"                     |
| `tangent`        | Off-topic aside                                                                          |
| `sponsor`        | A paid promotion                                                                         |
| `self_promo`     | The creator's own products, channels or other videos                                     |
| `cta`            | Asking viewers to like, subscribe, comment or follow                                     |
| `recap`          | Summary of what was covered                                                              |
| `payoff`         | The short moment the title's main promise is delivered                                   |
| `transition`     | A short bridge between sections                                                          |
| `outro`          | Closing words                                                                            |
| `end_screen`     | End cards or suggested videos, usually the last 5 to 20 seconds                          |
| `performance`    | Singing, playing, dancing or acting for the camera                                       |
| `other`          | None of the above                                                                        |

When two types fit, decide by what you see and hear most of the beat: shown being done is `demonstration`; judged by the creator is `opinion`; events narrated in order is `story`; the plan of this video is `setup` and background to it is `context`.
