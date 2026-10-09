# Status

Handoff log: one short entry per phase, newest first. Details live in `docs/notes/phase-NN.md`.

## Entries

### Phase 06: Extraction quality gate (Oct 9, 2026)

- **Built:**
  - agreement statistics in `@soundcheck/core/stats`;
  - `soundcheck consistency runs | human [--draft] | gate`, which take repeated extractions of a fixed six-video test set (pooled kappa, boundary F1, the gate verdict and confusions), compare them with a person's labels, and write a gate summary to `quality_reports`;
  - `docs/extraction-quality.md`.
- **Gate passed** with `beats-v5`, after 5 iterations ($6.19):
  - boundaries 0.76, beat types 0.65, visual 0.81;
  - energy, knowledge, density and talking-head share all 0.70 to 0.78.
  - The human reviewer kept all 40 beats; Gemini versus those labels is kappa 0.68 (82% of seconds).
- **Labels changed to pass:** `framing` became `talking_head_share` (1 to 5) and `visual`; there are sharper beat-type, energy and visual definitions.
- **Real data:** the test channel was re-extracted with `beats-v5` ($0.089).
- **Data gate still not met:** 1 channel, 3 videos.
- **Fixed:**
  - a Turborepo cache gap that let a stale web test pass (`transit` task);
  - Vertex timeouts under the Free Trial quota (billing upgraded to Paid; `undici` declined).
- **Next phases must keep:**
  - features only from a version with a passing `extraction-quality-gate` row;
  - a gate re-run after any prompt, label or model change;
  - care with beat types and payoff time, the least stable fields.

### Phase 05: Beat extraction with Gemini (Oct 8, 2026)

- **Built:**
  - `soundcheck extract beats` (and `extract load`): Gemini 3.8 Flash on Vertex AI reads each video from its YouTube URL and returns typed beats as structured JSON;
  - the answer is validated and repaired, and retried once with the exact errors;
  - results are cached by source, version, model, prompt and mode, and every raw answer is archived;
  - rows land in `beats`, the new `beat_videos` table and `extraction_runs`;
  - reviewed few-shot examples live in `@soundcheck/core/prompts`.
- **Verified live:**
  - all 4 videos of the test channel, at 100% coverage, about 20k tokens per video and $0.0085 per minute of video;
  - a re-run costs 0 tokens;
  - Nishchay spot-checked the extractions: "everything is right".
  - `pnpm check` passes (20 tasks).
- **Differs from spec:**
  - static is the default video mode; agentic (a setting) cost 2 to 7 times more and ran slower in the probe;
  - `"M:SS"` timestamps;
  - `performance` and `other` labels;
  - the prompt is a `.ts` module;
  - low media resolution has no effect on YouTube URLs.
  - 4 of the spec's 10 videos exist, so the other 6 wait for more channels.
- **Next phases must keep:**
  - read beats for the current cache key only;
  - leave the two example videos out of quality checks;
  - bump `EXTRACTION_VERSION` and re-review the examples for any label change;
  - update the prices in `.env` on Jan 1, 2027.

### Phase 04: Retention curves (Oct 7, 2026)

- **Built:**
  - `soundcheck ingest retention --channel UC… [--force]`: per eligible video, curves for all, subscribed, unsubscribed, and organic when ads bring more than 2% of views;
  - each curve has 100 points with `s_mono` (capped at 1) and hazards, plus `retention_coverage` rows and a printed coverage report;
  - `@soundcheck/core/stats` (survival maths), retention queries and parsers, and `readChannelRows`;
  - migration `002-retention-coverage.sql` (applied).
- **Verified live** on `UC-BHlgFbFh3V76yth-XCmlw`:
  - 3 videos with complete subscribed and unsubscribed curves; 900 curve rows and 12 coverage rows, 0 duplicates after a forced re-run;
  - hazards rebuild `s_mono` within 3.3e-16 (property test: 1e-9);
  - 18 Analytics calls, logged;
  - `pnpm check` passes (20 tasks).
- **Not met:** the data gate (at least 2 channels with 40+ complete videos). There is 1 channel with 3, so recruiting is blocked on OAuth test users and a deployed app.
- **Differs from spec:**
  - `startedWatching` and `stoppedWatching` empty the curve query, so they are asked for in a separate optional call; YouTube never returned them on the test channel, so they are null;
  - the end date is today minus 3 days (Pacific);
  - organic uses the `ADVERTISING` traffic share;
  - there is a `skipped` coverage status.
- **Next phases must keep:**
  - labels only from `complete` curves;
  - `rewatch_*` as outcomes, never features;
  - Shorts' early hazards are 0, so model or filter by `content_type`;
  - ingest order catalogue → stats → mix → retention.

### Phase 03: Catalogue and audience mix (Oct 7, 2026)

- **Built:**
  - `soundcheck ingest catalogue|stats|mix --channel UC… [--force]`, which land `videos`, `video_stats`, `video_traffic_mix` and `video_device_mix`;
  - the catalogue also starts the two reach report jobs for Phase 16;
  - `@soundcheck/core/jobs`: raw archive, BigQuery loads that replace a channel's rows, throttled build progress, step markers and `eligibleVideos`;
  - `scripts/probe-analytics.ts`, and anonymized Data API and Analytics fixtures.
- **Verified live** on `UC-BHlgFbFh3V76yth-XCmlw` after forced re-runs:
  - 4 videos, 3 eligible;
  - 6 stats rows, with 0 eligible videos missing either audience;
  - 43 traffic and 19 device rows, with shares summing to 1 in every slice;
  - 0 duplicates and 0 staging leftovers;
  - the pipeline image runs;
  - `pnpm check` passes (20 tasks).
- **Differs from spec:**
  - the content type comes from a multi-video query, because the top-videos shape returns 400, and its values arrive in camelCase;
  - the end date is today minus 3 days, in Pacific time;
  - eligibility accepts Shorts and live streams from 60 s to 3 h;
  - `engaged_views` is stored too;
  - re-runs replace the channel's rows and skip finished steps.
- **Next phases must keep:**
  - eligibility via `eligibleVideos` and the catalogue marker;
  - the ingest command pattern (archive before parse, `replaceChannelRows`, step markers);
  - one task per channel.

  `MIN_VIEWS=200` is a local testing override; restore it to 500 before onboarding real creators.

### Phase 02: Sign-in and channel connect (Oct 6, 2026)

- **Built:**
  - Auth.js v5 Google sign-in (`auth.config.ts`, `auth.ts`, and `proxy.ts` replacing middleware), JWT sessions holding only `userId` and `channelIds`.
  - `connectChannel` (scope check, `channels.list`, KMS-encrypted refresh token, upsert) and `credentialsForChannel` for jobs (`reauth_required` on `invalid_grant`).
  - `requireChannel` ownership checks, `GET /api/v1/me` and `DELETE /api/v1/channels/[id]`.
  - Pages `/`, `/app`, `/reauth` and `/connect/*`; `scripts/list-uploads.ts` and `scripts/record-fixtures.ts`.
- **Verified live** on `UC-BHlgFbFh3V76yth-XCmlw`:
  - the Firestore document holds only ciphertext, and `list-uploads` works;
  - deletion left 0 traces in Firestore, all 12 BigQuery tables and all three buckets, and revoked the token;
  - anonymous `/api/v1/**` gets 401.
  - `pnpm check` passes (20 tasks).
- **Differs from spec:** `proxy.ts` (Next 16); connect runs in `signIn`; extra pages for no channel, channel taken and errors; `@googleapis/youtube`; `sa-web` gained deletion roles.
- **Next phases must keep:** per-channel data under `channels/{id}`, a `channel_id` column in every table and a `{channel_id}/` prefix in every bucket; write BigQuery with load jobs, not streaming.

### Phase 01: Google Cloud foundation (Oct 4, 2026)

- **Built:** in project `soundcheck-510519` (Free Trial billing):
  - APIs, four least-privilege service accounts, three buckets, BigQuery dataset `soundcheck` with 12 tables;
  - Firestore `(default)` with deny-all rules, KMS key `oauth-tokens`, Artifact Registry `soundcheck`;
  - three secrets, an OAuth consent screen and web client, and a ₹4,200 a month budget.
  - All of it comes from idempotent scripts in `infra/` (`up.sh`, `07-budget.sh`), plus `scripts/vertex-smoke.ts`.
- **Models:** `GEMINI_MODEL=gemini-3.8-flash`, `GEMINI_FLASH_MODEL=gemini-3.5-flash-lite` (location `global`).
- **Verified:** every script ran twice cleanly, `bq ls` lists the tables, the smoke test gets replies from both models, secrets have versions, the budget exists, and `pnpm check` passes.
- **Deferred:** the Gemini quota increase. A Free Trial cannot request one; it needs an upgrade to Paid.

### Phase 00: Turborepo, tooling and CLAUDE.md (Oct 3, 2026)

- **Built:** a pnpm and Turborepo workspace:
  - `apps/web`: Next.js 16, placeholder `/`, `GET /api/healthz`.
  - `apps/pipeline`: commander CLI with stub commands, `shard()`, tsup bundle.
  - `packages/core`: env, logger, retry, gcp, versions.
  - `packages/ui` with shadcn set up, and `packages/vitest-config` with the network guard.
  - `services/modeling`: uv, Typer stubs.
  - Dockerfiles for all three services, and `CLAUDE.md`.
- **Verified:** `pnpm check` (18 tasks, TypeScript and Python) passes from a fresh copy, along with `pnpm build`, `pnpm dev` and all three Docker images.
- **Differs from the first spec draft:** Next.js 16, TypeScript 7, pnpm 12, Node 24; redaction matches key suffixes. The plan docs were updated to match.
- **Deferred:** CI and the Husky/lint-staged pre-commit hook (plan step 9).
- **Open:** unstage the four `apps/web/src/app` renames my `git mv` staged.
