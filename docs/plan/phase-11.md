# Phase 11 — Serving layer and API contracts

**Goal.** Everything the UI shows is precomputed into Firestore documents with stable, typed contracts, and the API exposes them. A frontend teammate can build every screen against fixtures before this phase finishes; draft the contracts below on Oct 6 for that reason.

**Depends on.** Phases 08 and 09. Day: Oct 11.

## Stack

- Next.js route handlers (Node runtime) and server-side data functions in `packages/core/src/data`
- zod v4 document schemas in `packages/core/src/schemas/documents.ts`; types via `z.infer`, no code generation
- Firestore; `@google/genai` (flash model) for narration at publish time

## Document contracts

- `channels/{id}`: `title`, `thumbnail_url`, `subscriber_count`, `build {state, stage, progress, run_id, error}`.
- `channels/{id}/summary/current`: `run_id`, `videos_analysed`, `beats_extracted`, `model_error_pp`, `baseline_error_pp`, `beats_baseline` (bool, from the bootstrap), `headline`, `audiences` (list of AudienceCard), `generated_at`.
- AudienceCard: `key` (`subscribers`, `newcomers`, `search`, `suggested`, `browse`), `label`, `kind` (`measured` or `estimated`), `view_share`, `watch_time_share`, `avg_view_pct`, `traits` (top 3 by absolute effect whose interval excludes zero: `{statement, delta_pp, ci}`), `description` (30 words max).
- `channels/{id}/index/videos`: one document listing every video `{video_id, title, published_at, duration_s, avg_view_pct, biggest_drop {at_s, loss_pp}, in_sample}` so the list screen is one read.
- `channels/{id}/videos/{video_id}`: `title`, `published_at`, `duration_s`, `thumbnail_url`, `stats {views, avd_s, avp}`, `audiences {subscribed|unsubscribed: {actual[100], predicted {p10[100], p50[100], p90[100]}}}`, `beats [{start_s, end_s, beat_type, framing, summary}]`, `drops` (list of Drop), `in_sample`.
- Drop: `audience`, `start_s`, `end_s`, `bin_start`, `bin_end`, `actual_loss_pp`, `attributions [{group, label, share}]`, `residual_share`, `narrative`.
- `soundchecks/{id}` (written in Phases 14 and 15; define the model now): `channel_id`, `status`, `progress`, `input {kind, uri | text, title, scenario}`, `duration_s`, `beats`, `prediction {audiences {p10, p50, p90}, avd_s, avp}`, `percentile_vs_channel`, `edits` (list of Edit), `narrative`, `visual_assumed` (bool).
- Edit: `edit_id`, `op` (`remove`, `trim`, `move`), `beat_index`, `params`, `label`, `rationale`, `delta_avp_pp {p10, p50, p90}`, `delta_avd_s {p10, p50, p90}`, `audience_driver`.

## Build

1. `apps/pipeline/src/commands/publish/drops.ts`: per video and audience, find bins where the 3-bin rolling loss is in the video's top decile and above 1.5 percentage points. Merge adjacent bins; keep at most 4 drops.
2. `publish/attribution.ts`: for each drop, compute each content feature's contribution to the logit relative to that video's median bin, (x minus x\_ref) times beta, using the TypeScript runtime. Exclude spline and position terms (not actionable; report them as "position in video"). Group features into human labels (sponsor placement, no visual change, knowledge gap, long single beat, branded intro, and so on), convert to shares of the explained excess, and set `residualShare` = 1 minus explained over actual excess, clipped to \[0, 1\]. The residual always ships.
3. `publish/narrate.ts`: Gemini receives only a JSON of numbers and labels and writes one or two sentences per drop and per audience card. Validate that every number in the output appears in the input (regex on digits); on failure retry once, then fall back to a template. Cache by input hash.
4. `soundcheck publish` (run as `job-publish`): read BigQuery and model artifacts, predict curves for every video with `sampleCurves` (mark training videos `inSample: true`), compute traits, drops and attributions, narrate, then write documents in Firestore batches of up to 500 operations. Every document is parsed with its zod schema before writing.
5. Data functions in `packages/core/src/data` (`getMe`, `getChannel`, `getSummary`, `listVideos`, `getVideo`), each calling `requireChannel` with the session user ID. Server components call them directly. Route handlers under `apps/web/src/app/api/v1/` wrap them for client components: `GET me`, `GET channels/[id]`, `GET channels/[id]/summary`, `GET channels/[id]/videos`, `GET channels/[id]/videos/[videoId]`, `POST channels/[id]/build`, `DELETE channels/[id]`. Response header `Cache-Control: private, max-age=30`.
6. `scripts/export-fixtures.ts` writes real documents for one channel to `apps/web/fixtures/`. When `NEXT_PUBLIC_USE_FIXTURES=true`, the data functions read fixtures instead of Firestore.
7. Types for every document are `z.infer` of the schemas, shared by the pipeline that writes them and the web app that reads them. There is no type generation step.
8. Tests: drop detection on synthetic curves; attribution shares plus residual sum to 1; the narration digit check rejects an invented number; `requireChannel` blocks another user's channel in every data function.

## Do not

- Generate narration on a request path. It is written once at publish time.

## Done when

- [ ] `job-publish` writes every document for a real channel
- [ ] Every data function and route handler returns data that parses with its zod schema
- [ ] p95 latency under 150 ms on Cloud Run
- [ ] Fixtures exported and fixtures mode works
- [ ] `docs/notes/phase-11.md` written
