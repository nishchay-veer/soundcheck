# Phase 05: Beat extraction with Gemini

Oct 8, 2026

Gemini on Vertex AI now splits every video into contiguous, typed beats.

- **Request:** structured JSON output, temperature 0 and a fixed seed.
- **Validation:** answers are checked against the video's length and repaired; a failed answer is retried once, with the exact problems listed.
- **Caching:** each extraction is cached under a key of everything that changes the answer, so a re-run costs no tokens.
- **Storage:** results land in BigQuery as `beats`, `beat_videos` and `extraction_runs`.

Built in six reviewed commits:

1. `Probe Gemini video extraction on Vertex AI`
2. `Add the beats schema and extraction prompt`
3. `Validate, stitch and cache beat extractions`
4. `Extract one video's beats with Gemini`
5. `Add the extract beats command and load beats into BigQuery`
6. `Verify Phase 05 live and write the notes` (these notes and the plan update)

The plan's fourth part was split in two (4 and 5 above) to keep each review small.

## Done when

Verified Oct 8, 2026 on channel `UC-BHlgFbFh3V76yth-XCmlw` with `gemini-3.8-flash`, static mode, location `global`.

| Item                                                                                                   | Status                   | Evidence                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 10 videos from a real channel extracted and all pass validation                                        | **4 of 10** (decision A) | All 4 of the channel's videos pass, each with 100% coverage. The other 6 wait for more connected channels                                                                                                              |
| Cost per minute of video and tokens per video recorded in the notes                                    | Done                     | "Cost and tokens" below                                                                                                                                                                                                |
| A re-run costs zero tokens (cache hit)                                                                 | Done                     | A second `extract beats` on the 3 eligible videos returned `cached` for all three, with 0 calls and 0 tokens. `extraction_runs` shows them as `cached` with 0 tokens                                                   |
| A teammate spot-checks 3 videos against the output and records whether boundaries and types make sense | Done (2 + 1)             | Nishchay watched the 3:42 video and the 0:31 Short, which Gemini never saw as examples: "everything is right". The 4:22 cover is one of the two examples he had already corrected; its extraction matches that example |
| `docs/notes/phase-05.md` written                                                                       | Done                     | This file                                                                                                                                                                                                              |

Also verified:

- **BigQuery:** `beats` has 21 rows (0 duplicates); `beat_videos` has 4; `extraction_runs` has every run.
- **Archive:** every raw Gemini answer is archived under `gemini-beats/`.
- **Checks:** `pnpm check` passes all 20 tasks (core 387 tests, pipeline 81, web 24, ui 4), and the pipeline bundle builds with the prompt and examples inside it.

## Cost and tokens

At Vertex AI's Gemini 3.8 Flash global prices: input (text, image, video, audio) $0.75 and output (answer and thinking) $3.75 per million tokens, through Dec 31, 2026.

| Video                 | Beats | Tokens in | Tokens out (incl. thinking) | Total tokens | Cost        | Time |
| --------------------- | ----- | --------- | --------------------------- | ------------ | ----------- | ---- |
| 4:22 cover            | 6     | 28,032    | 2,480                       | 30,512       | $0.0303     | 47 s |
| 3:42 video            | 8     | 24,404    | 2,968                       | 27,372       | $0.0294     | 94 s |
| 1:28 GDSC application | 4     | 12,204    | 1,352                       | 13,556       | $0.0142     | 55 s |
| 0:31 Short            | 3     | 7,092     | 1,714                       | 8,806        | $0.0117     | 53 s |
| **All 4** (10.05 min) | 21    | 71,732    | 8,514                       | 80,246       | **$0.0856** |      |

- **Tokens per video:** about 20,000 on average. About 4,300 of every call's input is the prompt with its two examples.
- **Video and audio:** about 91 tokens per second of video (66 video, 25 audio).
- **Cost per minute of video:** **$0.0085** across all four. Long videos come to about $0.0074 a minute, and the 31 s Short to $0.023 a minute, because the prompt dominates.
- **A 500-video channel** of 10-minute videos would cost about $42.
- **From Jan 1, 2027** these prices double ($1.50 and $7.50); update `.env` then.

The GDSC row comes from the smoke test that cached it, before prices were set, so its cost is computed here from its tokens. Every later run of it was a cache hit.

## What exists

- **Core `@soundcheck/core/schemas` (`beats.ts`):**
  - the wire schema Gemini answers in (`"M:SS"` times) and the stored schema (seconds, plus words per minute computed in code);
  - the label enums, including `performance` and `other`;
  - `geminiResponseJsonSchema()`;
  - row schemas for `beats`, `beat_videos` and `extraction_runs`, and the five extraction statuses.
- **Core `@soundcheck/core/prompts`:**
  - the extraction instructions: role, rules, every label explained, every 1-to-5 scale anchored at 1, 3 and 5, and "never estimate retention";
  - two reviewed examples (`application-video.json`, `music-cover.json`);
  - `beatExtractionPrompt()`.
- **Core `@soundcheck/core/gemini`:**
  - `validate-beats.ts`: repairs and rejections, with errors phrased for Gemini;
  - `stitch.ts`: windows for videos over 40 minutes, and stitching with merges capped at 600 s;
  - `cache.ts`: the key, prompt hash and GCS cache;
  - `extract.ts`: `extractVideoBeats`, with the cache, a call per window, the raw archive, one retry with errors, usage and cost;
  - `runs.ts`: run records and row builders;
  - `getGenAI()` in `gcp.ts`;
  - `FakeGenAI` for tests.
- **Settings:** `GEMINI_VIDEO_MODE` (`static` by default, or `agentic`), `GEMINI_PRICE_INPUT_PER_M` and `GEMINI_PRICE_OUTPUT_PER_M`. The local `.env` has 0.75 and 3.75.
- **Pipeline:**
  - `soundcheck extract beats --channel UC… [--video ID] [--limit N] [--no-cache]`, which prints a per-video table with tokens, cost and time;
  - `soundcheck extract load --channel UC…`.
- **Infra:** `infra/bigquery/beat_videos.sql` (applied).
- **Scripts:**
  - `probe-gemini-video.ts`;
  - `draft-beat-example.ts`, which drafts a new example for a person to correct.

## Decisions

Approved at planning:

- **A.** Extract the channel's 4 videos now; the other 6 wait for more creators.
- **B.** Examples are drafted by Gemini and corrected by someone who watched the videos.
- **C.** Video-level fields go in a new `beat_videos` table.
- **D.** Prices come from env, never hardcoded with a model ID.
- **E.** Eligible videos by default, and `--video` for any catalogue video.

Made during the build, by Nishchay:

- **Static by default, agentic as a setting.** He first asked for agentic. After the probe showed it cost 2 to 7 times more and ran 7 to 15 times slower for whole-video beats, he chose static as the default and kept agentic as `GEMINI_VIDEO_MODE=agentic`.
- **`performance` and `other` added** to the spec's labels, for his music videos and for the prompt's "when unsure, choose other".
- **The examples were accepted as drafted.** They keep his name in the GDSC example and the song's lyrics in the cover example. Shorten them if the repo is ever made public.
- **Prices set** from the official Vertex AI pricing page.

## Changes from the spec

All are recorded in `docs/plan/phase-05.md`.

- **Timestamps are `"M:SS"` strings in Gemini's answer**, converted to seconds in code. Plain seconds came back garbled in both modes, and the strings were always correct.
- **Low media resolution is not used.** It changed nothing for YouTube URLs, either in the config or on the video part (5,742 video tokens for the 88 s video either way).
- **The prompt is a TypeScript module**, not a `.md` file, so tests, `tsx` scripts and the pipeline bundle all load it without extra loaders.
- **Labels:** `performance` (formats and beat types) and `other` (beat types) were added.
- **Validation:**
  - overlaps under 2 s are closed like gaps;
  - larger overlaps, beats after the end and a payoff after the end are rejected;
  - the first beat is snapped to 0.
- **Stitching** drops later beats that end inside the overlap. The crossing beat merges only when its type matches and the merged beat stays within 600 s.
- **The cache key adds the video mode**, and the prompt hash includes the examples and the response schema.
- **`extraction_runs` is one row per video per run**, with each Gemini call in `details`, and cache hits are included.
- **There is a separate `extract load`** that rebuilds rows from GCS, so sharded tasks never overwrite each other.
- **Private videos** are detected from `videos.list` before any call.

## Video modes probed

`pnpm --filter @soundcheck/scripts probe-gemini-video --channel UC-BHlgFbFh3V76yth-XCmlw --video <GDSC video>`, Oct 8, 2026, with the video ID masked. The same probe on the 4:22 cover gave:

| Task                       | static              | agentic                                                        |
| -------------------------- | ------------------- | -------------------------------------------------------------- |
| Describing the video       | 23,928 tokens       | 5,201 tokens                                                   |
| Segmenting the whole video | 24,196 tokens, 56 s | 140,362 and 170,275 tokens (6 and 5 segments), 103 s and 183 s |

```
# Gemini video probe, 2026-10-08
Model gemini-3.8-flash on Vertex AI (global); video VIDEO, 88 s, public.

## static: YouTube URL, default resolution
  OK in 8.6 s. tokens: prompt 7937 (AUDIO=2185 TEXT=10 VIDEO=5742), output 41, thinking 233, tool use 0, total 8211
  answer: A young man wearing glasses speaks directly into the camera while gesturing with his hands. He introduces himself and presents his application pitch to become the next Google Developer Student Clubs (GDSC) Lead at his institute.

## agentic: YouTube URL, default resolution
  OK in 14.3 s. tokens: prompt 246 (TEXT=246), output 143, thinking 857, tool use 12520, total 13766
  answer: A young man wearing glasses sits in front of a camera and introduces himself while presenting his application to become the Google Developer Student Clubs (GDSC) lead at his university. He discusses his technical background, leadership and

## default processing (unspecified)
  OK in 7.7 s. tokens: prompt 7937 (VIDEO=5742 TEXT=10 AUDIO=2185), output 63, thinking 184, tool use 0, total 8184
  answer: A young man sits in front of a doorway and speaks directly into the camera, introducing himself and sharing his background in technology and mentorship. He then explains his motivation for applying to become a Google Developer Student Club

## static: low media resolution
  OK in 4.9 s. tokens: prompt 7937 (VIDEO=5742 TEXT=10 AUDIO=2185), output 51, thinking 183, tool use 0, total 8171
  answer: A young man addresses the camera in an application video, detailing his background in technology, leadership experience, and motivations for applying to become a GDSC Lead. He outlines his vision to connect students with industry profession

## agentic: low media resolution
  OK in 8.6 s. tokens: prompt 246 (TEXT=246), output 145, thinking 720, tool use 12521, total 13632
  answer: A young man wearing glasses sits in front of the camera and delivers an application video to become the Google Developer Student Club (GDSC) lead at his university. Speaking directly to the viewer throughout the recording, he explains his t

## static: 60 s to 120 s only (videoMetadata offsets)
  OK in 6.2 s. tokens: prompt 2478 (AUDIO=686 TEXT=10 VIDEO=1782), output 35, thinking 252, tool use 0, total 2765
  answer: A young man wearing glasses speaks directly to the camera while gesturing with his hands. He delivers a speech about his technical background and leadership skills before concluding with a polite thank you.

## structured: static, responseJsonSchema
  OK in 21.5 s. tokens: prompt 8121 (VIDEO=5742 TEXT=194 AUDIO=2185), output 191, thinking 137, tool use 0, total 8449
  4 segments, 100.0% of 88 s covered, gaps over 2 s: none, times past the end: 2
    0-30 Introduction and background experience | 30-56 Vision and motivation for becoming GDSC Lead | 56-121 Technical expertise and leadership qualities | 121-128 Conclusion and closing remarks

## structured: agentic, responseJsonSchema
  OK in 135.9 s. tokens: prompt 430 (TEXT=430), output 731, thinking 1846, tool use 11864, total 14871
  6 segments, 99.1% of 88 s covered, gaps over 2 s: none, times past the end: 0
    0-10 Introduction | 10-30 Community and Mentorship Experience | 30-54 Vision for GDSC | 54-70 Technical and Leadership Skills | 70-81 Key Leadership Qualities | 81-87.199 Outro

## structured: agentic, responseJsonSchema, run again (same seed)
  OK in 73.0 s. tokens: prompt 430 (TEXT=430), output 633, thinking 2283, tool use 33009, total 36355
  5 segments, 99.1% of 88 s covered, gaps over 2 s: none, times past the end: 0
    0-10 Introduction | 10-30 Experience and mentorship | 30-56 Vision and goals as GDSC lead | 56-81 Technical skills and leadership qualities | 81-87.199 Conclusion

## static: low resolution on the video part
  OK in 20.1 s. tokens: prompt 7937 (VIDEO=5742 TEXT=10 AUDIO=2185), output 53, thinking 223, tool use 0, total 8213
  answer: A young man speaks directly to the camera, presenting his application to become the Google Developer Student Clubs (GDSC) lead for his university. He shares his leadership experiences, technical skills, and vision for fostering a collaborat

## structured timestamps: static, M:SS strings
  OK in 10.1 s. tokens: prompt 8199 (VIDEO=5742 TEXT=272 AUDIO=2185), output 156, thinking 237, tool use 0, total 8592
  5 segments, 100.0% of 88 s covered, gaps over 2 s: none, times past the end: 0
    0-17 Introduction | 17-37 Community Mentorship Experience | 37-56 Vision as GDSC Lead | 56-81 Technical and Leadership Qualities | 81-88 Conclusion and Outro

## structured timestamps: static, seconds with descriptions
  OK in 13.1 s. tokens: prompt 8193 (AUDIO=2185 TEXT=266 VIDEO=5742), output 150, thinking 146, tool use 0, total 8489
  4 segments, 100.0% of 88 s covered, gaps over 2 s: none, times past the end: 0
    0-30 Introduction and background | 30-56 Motivation and vision for GDSC | 56-81 Technical and leadership qualifications | 81-88 Outro

## structured timestamps: agentic, M:SS strings
  OK in 147.6 s. tokens: prompt 508 (TEXT=508), output 587, thinking 2642, tool use 41463, total 45200
  4 segments, 98.9% of 88 s covered, gaps over 2 s: none, times past the end: 0
    0-30 Self-introduction and community experience | 30-55 Motivation and vision for leading GDSC | 55-80 Technical skills and leadership qualities | 80-87 Outro

13 Gemini calls, 184898 tokens in total.
```

## Incidents

- **Garbled timestamps.** The first structured probes returned times like `413` for 4:13 and `121` for 1:21. They were fixed by asking for `"M:SS"` strings, which the validator converts.
- **Merged beats over 600 s.** A long-video test showed that merging same-type beats across a window boundary could create a beat longer than 600 s, which made the whole video fail validation. Merges are now capped.
- **A `MaxListenersExceededWarning`** appears in runs that read many GCS files. Traced with `--trace-warnings` to `teeny-request`, the HTTP layer inside Google's storage client: a library-level warning with no effect on results. It shows up as stderr noise in the logs.
- **Test-only mistakes:** a few expectations were wrong (a 28 s gap still leaves 95% coverage, and $0.00975 prints as $0.0097). They were fixed in the tests; the code was right.

## Notes for later phases

- **Phase 06** (consistency):
  - Temperature 0 and a fixed seed still vary: agentic gave 6 and then 5 segments for the same request.
  - Measure static's stability with `--no-cache` re-runs.
  - Raw answers are archived under `gemini-beats/{video}-w{window}-a{answer}/`.
- **Phase 07** (features):
  - Read `beats` and `beat_videos` for the current extraction only. `extract load` loads just the current settings' cache key.
  - Per-beat features are in `beats.details`; words per minute is computed there.
  - `payoff_time_s` and `format` are in `beat_videos`.
- **The examples are part of the cache key.** Editing them, or any prompt text, re-extracts every video. Bump `EXTRACTION_VERSION` for label or field changes, then re-draft and review the examples with `draft-beat-example.ts`.
- **Contamination:** the two example videos (the GDSC application and the 4:22 cover) come back looking like their examples. Leave them out of any evaluation of extraction quality.
- **Music channels:** almost every beat is `performance` with music in the foreground, so beat features will vary little on music channels. Retention modeling there leans on the audience and mix data.
- **Long videos (over 40 minutes)** are only unit-tested; no channel has one yet. Check the first real one by hand.
- **Phase 10:** run `extract beats` sharded, then `extract load` once.
- **Prices change on Jan 1, 2027:** set `GEMINI_PRICE_INPUT_PER_M=1.50` and `GEMINI_PRICE_OUTPUT_PER_M=7.50`.
