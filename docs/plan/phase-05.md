# Phase 05 — Beat extraction with Gemini

**Goal.** Turn every video into a validated, timestamped sequence of beats with typed features, using Gemini on Vertex AI with structured output. Results are cached and versioned, so re-runs cost nothing.

**Depends on.** Phase 03 (video list). Day: Oct 4.

## Stack

- `@google/genai`: `new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION })` and `ai.models.generateContent`
- Content parts with `fileData` (`fileUri` = YouTube URL or `gs://` URI, `mimeType` = `video/*`), `mediaProcessing` (`STATIC` or `AGENTIC`) and `videoMetadata` (`startOffset`, `endOffset`); `mediaResolution` has no effect on YouTube URLs (probed)
- Config: `systemInstruction` (the prompt with its examples), `responseMimeType: "application/json"`, `responseJsonSchema: z.toJSONSchema(...)` (accepted as is, including `anyOf`, `pattern` and `additionalProperties`), `temperature: 0`, a fixed `seed`
- zod v4 to define and parse the output; `@google-cloud/storage`; `@google-cloud/bigquery`; p-limit

## Build

1. Schema in `packages/core/src/schemas/beats.ts (zod)`. Gemini answers in a wire form whose timestamps are `"M:SS"` strings (`start`, `end`, `payoff_time`), because plain seconds came back garbled in the probe ("1:21" as 121); code converts them to `start_s`, `end_s` and `payoff_time_s`. `format` and `beat_type` also include `performance` (music, dance or acting), and `beat_type` includes `other`, as the prompt's "when unsure, choose other" needs. Video-level fields are stored in a `beat_videos` table, one row per video and extraction.
   - `VideoBeats`: `schema_version` (literal `beats-v1`), `video_summary` (60 words max), `format` (enum: tutorial, explainer, review, vlog, commentary, story, interview, listicle, challenge, news, other), `title_promise` (what the title and opening promise the viewer), `target_level` (1 to 5, assumed expertise), `payoff_time_s` (nullable: when the main promise is delivered), `beats` (list of `Beat`).
   - `Beat`: `start_s`, `end_s`; `beat_type` (enum: cold\_open, hook, intro\_branding, setup, context, explanation, demonstration, example, story, opinion, tangent, sponsor, self\_promo, cta, recap, payoff, transition, outro, end\_screen); `framing` (enum: talking\_head\_static, talking\_head\_moving, screen\_recording, b\_roll, graphics, slides, gameplay, mixed, other); `cuts_per_min` (int); `on_screen_text` (bool); `music` (none, background, foreground); `energy`, `assumed_knowledge`, `info_density` (each 1 to 5); `opens_loop` (nullable string: a question raised here and answered later); `closes_loop` (bool); `speaker_count` (int); `transcript` (verbatim speech, empty if none); `summary` (20 words max).
2. Prompt in `packages/core/src/prompts/extract-beats.ts` (Markdown in a TypeScript string, so tests, scripts and the bundle load it the same way), versioned with the schema:
   - Role: a video editor annotating footage for an analytics model.
   - Rules: beats are contiguous and cover the whole video with no gaps or overlaps; a beat is a span with one purpose, usually 8 to 90 seconds; split when purpose or framing changes; timestamps are seconds from the start; never infer from the title alone; when unsure, choose `other`.
   - Anchored scales: give a one-line definition for 1, 3 and 5 on every 1-to-5 field.
   - Two few-shot examples from real videos in `prompts/examples/`: drafted by Gemini with `scripts/draft-beat-example.ts`, then checked by a teammate who has watched them (`reviewed: true`, enforced by a test).
3. Sources: back catalogue uses the YouTube URL `https://www.youtube.com/watch?v=ID` (public or unlisted only; private videos, known from `videos.list`, are marked `private_unavailable` without a call). Uploads in Phase 14 use `gs://` URIs. YouTube URLs work on Vertex AI with `gemini-3.8-flash`. The mode is the `GEMINI_VIDEO_MODE` setting, default `static`: in the probe, agentic mode cost 2 to 7 times the tokens of static for whole-video segmentation, ran 7 to 15 times slower and varied between runs, though it covered the video.
4. Long videos: above 40 minutes, extract in 20-minute windows with 30 seconds of overlap using `startOffset` and `endOffset`; Gemini gives window-relative times and code shifts them. Stitch by dropping beats from the later window that end inside the overlap, and merging the boundary beat when both sides share a type and the result stays within 600 s (otherwise the later beat starts where the earlier one ends). Low media resolution is not used: it has no effect on YouTube URLs.
5. `packages/core/src/gemini/validate-beats.ts`: sort beats; close gaps and overlaps under 2 s by moving the previous beat's end; start the first beat at 0 and clamp or extend the last `end_s` to the duration. Also reject overlaps of 2 s or more, a beat starting after the end, and a payoff after the end. Reject when coverage is under 95%, any beat is under 1 s or over 600 s, or the JSON fails the schema. On rejection, retry once with the specific error appended (for example, "Your output has a gap from 312 s to 340 s"). Compute words per minute per beat from the transcript in code, not in the prompt.
6. Cache key: `sha256(source_uri, EXTRACTION_VERSION, model_id, prompt_hash, video_mode)`, where the prompt hash covers the instructions, examples and response schema. Store validated JSON at `gs://{project}-raw/{channel}/beats/{video_id}/{key}.json`, rows in `beats` (per-beat features in `details`) and `beat_videos`, and a row in `extraction_runs` per video per run with tokens in and out, latency, cost estimate (from `GEMINI_PRICE_INPUT_PER_M` and `GEMINI_PRICE_OUTPUT_PER_M`) and status. A cache hit skips the call. Every raw Gemini answer is also archived under `gemini-beats/` before parsing.
7. Concurrency: 4 requests at a time per Cloud Run task (p-limit); tasks shard the video list with `shard()`. Each task writes run records to GCS; the BigQuery rows are rebuilt from the cache and run records by one load, which a single-task run does itself and a sharded run leaves to `extract load`.
8. CLI: `soundcheck extract beats --channel UC... [--video ID] [--limit N] [--no-cache]` and `soundcheck extract load --channel UC...`.
9. Tests: validator against crafted good and bad outputs; stitching logic; cache-key stability; schema round-trip. Unit tests mock the Gemini client.

## Decisions and gotchas

- Video Intelligence and Speech-to-Text are not model inputs. Back-catalogue media cannot be downloaded, so those features would exist at prediction time but never at training time.
- Temperature 0 is not a guarantee of identical output. Phase 06 measures how stable the extraction really is.
- Any change to the enums or prompt bumps `EXTRACTION_VERSION`, which invalidates the cache on purpose.

## Do not

- Ask Gemini to estimate retention, popularity or anything else the analytics already measure.
- Hardcode a model ID.

## Done when

- [ ] 10 videos from a real channel extracted and all pass validation
- [ ] Cost per minute of video and tokens per video recorded in the notes
- [ ] A re-run costs zero tokens (cache hit)
- [ ] A teammate spot-checks 3 videos against the output and records whether boundaries and types make sense
- [ ] `docs/notes/phase-05.md` written
