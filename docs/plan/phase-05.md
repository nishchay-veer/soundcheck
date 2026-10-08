# Phase 05 — Beat extraction with Gemini

**Goal.** Turn every video into a validated, timestamped sequence of beats with typed features, using Gemini on Vertex AI with structured output. Results are cached and versioned, so re-runs cost nothing.

**Depends on.** Phase 03 (video list). Day: Oct 4.

## Stack

- `@google/genai`: `new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION })` and `ai.models.generateContent`
- Content parts with `fileData` (`fileUri` = YouTube URL or `gs://` URI, `mimeType` = `video/*`) and `videoMetadata` (`startOffset`, `endOffset`, `fps`); `mediaResolution` in the config
- Config: `responseMimeType: "application/json"`, `responseJsonSchema: z.toJSONSchema(VideoBeats)` (fall back to `responseSchema` if the current SDK or model rejects it), `temperature: 0`, a fixed `seed`
- zod v4 to define and parse the output; `@google-cloud/storage`; `@google-cloud/bigquery`; p-limit

## Build

1. Schema in `packages/core/src/schemas/beats.ts (zod)`.
   - `VideoBeats`: `schema_version` (literal `beats-v1`), `video_summary` (60 words max), `format` (enum: tutorial, explainer, review, vlog, commentary, story, interview, listicle, challenge, news, other), `title_promise` (what the title and opening promise the viewer), `target_level` (1 to 5, assumed expertise), `payoff_time_s` (nullable: when the main promise is delivered), `beats` (list of `Beat`).
   - `Beat`: `start_s`, `end_s`; `beat_type` (enum: cold\_open, hook, intro\_branding, setup, context, explanation, demonstration, example, story, opinion, tangent, sponsor, self\_promo, cta, recap, payoff, transition, outro, end\_screen); `framing` (enum: talking\_head\_static, talking\_head\_moving, screen\_recording, b\_roll, graphics, slides, gameplay, mixed, other); `cuts_per_min` (int); `on_screen_text` (bool); `music` (none, background, foreground); `energy`, `assumed_knowledge`, `info_density` (each 1 to 5); `opens_loop` (nullable string: a question raised here and answered later); `closes_loop` (bool); `speaker_count` (int); `transcript` (verbatim speech, empty if none); `summary` (20 words max).
2. Prompt in `packages/core/src/prompts/extract-beats.md`, versioned with the schema:
   - Role: a video editor annotating footage for an analytics model.
   - Rules: beats are contiguous and cover the whole video with no gaps or overlaps; a beat is a span with one purpose, usually 8 to 90 seconds; split when purpose or framing changes; timestamps are seconds from the start; never infer from the title alone; when unsure, choose `other`.
   - Anchored scales: give a one-line definition for 1, 3 and 5 on every 1-to-5 field.
   - Two hand-written few-shot examples from real videos in `prompts/examples/`, written by a teammate who has watched them.
3. Sources: back catalogue uses the YouTube URL `https://www.youtube.com/watch?v=ID` (public or unlisted only; private videos fail and are marked `private_unavailable`). Uploads in Phase 14 use `gs://` URIs. Before wiring, check the current Vertex AI docs for YouTube URL support and for the agentic video mode Google announced on Sep 1, 2026. Put the mode behind a `GEMINI_VIDEO_MODE` setting and default to whichever works.
4. Long videos: above 40 minutes, extract in 20-minute windows with 30 seconds of overlap using `start_offset` and `end_offset`. Stitch by dropping beats from the later window that start inside the overlap, and merging a boundary beat when both sides share a type. Use low media resolution above 20 minutes.
5. `packages/core/src/gemini/validate-beats.ts`: sort beats; close gaps under 2 s by extending the previous beat; clamp the last `end_s` to the duration. Reject when coverage is under 95%, any beat is under 1 s or over 600 s, or the JSON fails the schema. On rejection, retry once with the specific error appended (for example, "Your output has a gap from 312 s to 340 s"). Compute words per minute per beat from the transcript in code, not in the prompt.
6. Cache key: `sha256(source_uri, EXTRACTION_VERSION, model_id, prompt_hash)`. Store validated JSON at `gs://{project}-raw/{channel}/beats/{video_id}/{key}.json`, rows in `beats`, and a row in `extraction_runs` with tokens in and out, latency, cost estimate and status. A cache hit skips the call.
7. Concurrency: 4 requests at a time per Cloud Run task (p-limit); tasks shard the video list with `shard()`.
8. CLI: `soundcheck extract beats --channel UC... [--video ID] [--limit N] [--no-cache]`.
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
