# Status

Handoff log: one short entry per phase, newest first. Details live in `docs/notes/phase-NN.md`.

## Entries

### Change: training minimum lowered to 8 videos (Oct 15, 2026)

- **Nishchay's decision:** `MIN_TRAIN_VIDEOS` is now 8 (was 20), in the code defaults (TypeScript and Python), `.env.example`, `.env`, the workflow deploy script and the specs. A build with fewer usable videos still stops as `insufficient_data`, and a model trained on fewer is still not usable.
- **What follows from it:**
  - the held-out accuracy test now needs 14 settled videos (6 tested, 8 for training), not 26;
  - a channel's models are marked usable from 8 videos, so "Not a result yet" goes and soundchecks recommend edits much sooner; their ranges are wider;
  - cross-validation already uses fewer folds with fewer videos, so training needs no other change;
  - the landing page now reads the minimum from the setting instead of repeating it, like the building and audiences screens;
  - estimated audiences keep their own rule of 30 videos (`ESTIMATED_AUDIENCE_RULE`).
- **To reach the cloud:** `deploy-workflows.sh` (the build's stop rule), `deploy-pipeline.sh` and `deploy-web.sh`, all reading `.env`. Saved models still state the minimum they were trained under until the channel is rebuilt.

### Phase 14: Soundcheck upload and prediction (Oct 13, 2026)

- **Built:**
  - soundchecks of an uploaded file (up to 2 GB, chunked, resumable) or a public or unlisted YouTube link: `/app/soundcheck`, `/new` and `/[id]`, with the four "Expected traffic" scenarios;
  - `job-soundcheck`: checks the cut (ffprobe, or YouTube's data, which refuses private links), Gemini watches it, each audience's model predicts it (`predictCut`: bands and average view as ranges, both audiences weighted, better than N% of the newest 20 videos);
  - the API routes, the `soundcheck` workflow and the Eventarc trigger `soundcheck-upload`;
  - `channels/{id}/soundchecks/{id}` and its `inputs/current` (the cut as the model reads it) for Phase 15.
  - Scripts are left out, by Nishchay's decision.
- **Verified live:**
  - a 67 s upload went from upload to result in 2 min 38 s (mostly the job starting);
  - a private link and a too-short file each ended with the right message;
  - the probe showed unlisted links work and private ones cannot.
- **To do:** a ready unlisted link of at least a minute; a 10-minute cut timed against the 6-minute target.
- **Next phases must keep:**
  - "Not a result yet" on soundchecks too;
  - no Gemini or BigQuery on a request path (Phase 15's simulate route reads `inputs/current`);
  - soundchecks under the channel.

### Change: Shorts left out of training (Oct 13, 2026)

- **Nishchay's decision,** reversing Phase 03's: Shorts are no longer eligible, whatever their length (`exclusion_reason` `unsupported_content_type`).
- **Why:** Shorts loop, so their retention starts above 100%, and viewers swipe through them in a feed. The model has no input that marks a Short (Phase 03 and 04 flagged this; Phases 07 and 08 did not handle it), so mixed channels trained one blurred model.
- **What follows from it:**
  - Shorts don't count toward the 20 videos, and Gemini no longer watches them;
  - the building screen says a video counts when it is not a Short;
  - a Shorts-only channel stops as `insufficient_data`.
- **Later:** a separate Shorts model, or a Short input to this one.
- **To reach the cloud:** `deploy-pipeline.sh` (ingest) and `deploy-web.sh` (the screen's text).

### Change: training minimum lowered to 20 videos (Oct 13, 2026)

- **Nishchay's decision:** `MIN_TRAIN_VIDEOS` is now 20 (was 30), in the code defaults, `.env.example` and the specs. A build with fewer usable videos still stops as `insufficient_data`, and a model trained on fewer is still not usable.
- **What follows from it:**
  - a held-out test now needs 26 settled videos (6 tested, 20 for training), not 38;
  - estimated audiences keep their own rule of 30 videos (`ESTIMATED_AUDIENCE_RULE`).
- **To reach the cloud:** `deploy-workflows.sh` (the build's stop rule), `deploy-pipeline.sh` and `deploy-web.sh`, all reading `.env`. Saved models and documents still say "at least 30" until the channel is rebuilt; `docs/model-card.md` updates on the next evaluation.

### Phase 13: Video autopsy screen (Oct 12, 2026)

- **Built:**
  - `/app/videos`: search, five sorts, each video's biggest drop-off;
  - `/app/videos/[videoId]`: each audience's curve with the model's band over the beat strip on one D3 time scale, the YouTube player beside it, and a drop panel (a sentence, cause chips with "?" notes, the unexplained rest, links to the audiences sheet);
  - beat transcript snippets in the video documents (`serving-v3`);
  - a Popover primitive for notes that open on a tap.
- **Verified:**
  - all 3 test videos on the deployed app, identical to fixtures mode;
  - the fixtures re-export matches Firestore byte for byte;
  - the smoke test reads the real player's time after a drop-off click (39.3 s);
  - no overflow at 390 px;
  - Lighthouse accessibility 100 on three pages.
- **Next phases must keep:**
  - the panel's sentence and the "?" notes come from the chips' numbers, not Gemini;
  - "Unexplained" always shows.
- **Open:**
  - narrated end times can be a second off the page's (narrate from rounded times);
  - Phase 12's stat-card tooltips don't open on a tap;
  - `d3-array` is unused.

### Phase 12: Onboarding and audiences screen (Oct 12, 2026)

- **Built,** on the design system, reviewed once on `/styleguide`:
  - restyled shadcn/Radix primitives and the app's components (stat cards, effect bars with intervals, audience cards, the retention chart and beat strip);
  - the landing page; `/app` routing by build state; the app bar, with "Soon" for screens to come; channel settings;
  - the building screen, with live progress polled every 3 s and every state, including "not enough videos" with a preview link;
  - the audiences screen: the numbers, the headline, the cards, and a sheet with every simulated effect (a new `effects` field, `serving-v2`).
- **Verified:**
  - the full flow on the deployed app, including a live Check again build;
  - fixtures mode with no Google credentials;
  - Lighthouse accessibility 100 on four pages;
  - no overflow at 390 px;
  - a Playwright smoke test;
  - the Monday refresh ran on schedule.
- **Real data:** the screens say "Not a result yet" (3 videos; the gate is overridden by Nishchay's decision). Model error reads "Not measured", and no effect is clear.
- **Next phases must keep:**
  - "Not a result yet" wherever model numbers show unusable models;
  - deploy the pipeline before the web app when a document changes;
  - fix or reword the Vertex AI Experiments deletion gap;
  - restore `MIN_VIEWS=500` before real creators.

### Phase 11: Serving layer and API contracts (Oct 11, 2026)

- **Built:**
  - zod contracts for every serving document (`schemas/documents.ts`): the summary with audience cards, the video list, video pages with curves, beats and drop-offs, and the soundcheck and edit documents for Phases 14 and 15;
  - `soundcheck publish` (the build's last stage): predicted bands, drop-offs attributed to content groups with a residual that always ships, traits, and Gemini captions whose numbers must all be in their facts;
  - `getChannel`, `getSummary`, `listVideos` and `getVideo`, owner-only, and their `/api/v1` routes;
  - fixtures mode (`NEXT_PUBLIC_USE_FIXTURES`, development only) and `export-fixtures`;
  - `infra/deploy-web.sh`: the app on Cloud Run.
- **Verified live:**
  - `job-publish` wrote every document for the test channel; a re-run writes nothing;
  - p95 55 ms on Cloud Run over 499 requests;
  - fixtures mode served every route with no Google credentials.
  - sign-in works on the deployed app.
- **Real data:** every document is stamped "not usable" (3 videos). The evaluation is empty and there are no traits; drop-offs are mostly unexplained.
- **Next phases must keep:**
  - show "not a result yet" whenever `model.usable` is false;
  - re-run `export-fixtures` after document changes; the fixtures hold real analytics;
  - add the deployed origin to the uploads bucket's CORS before uploads there (`WEB_ORIGIN=… infra/02-storage.sh`);
  - redeploy the web app and the jobs after changes to `packages/core`.

### Phase 10: Pipeline orchestration (Oct 10, 2026)

- **Built:**
  - `channel_build` in Cloud Workflows runs eight Cloud Run jobs (ingest, extract, extract-load, features, train, baseline, evaluate, publish) from the pipeline and modeling images, with retries, the `MIN_TRAIN_VIDEOS` stop and failures recorded with the stage and message.
  - `startChannelBuild` (Connect, `POST /api/v1/channels/[id]/build`, `soundcheck build start`) queues the build in a transaction, replaces stale builds, and starts the workflow.
  - Throttled progress with an ETA on `channels/{id}.build`, from both languages.
  - `weekly_refresh` on Mondays at 03:00 IST, plus the deploy and IAM scripts.
- **Verified live on the 3-video channel:**
  - without `allow_small`, `insufficient_data` after 4.6 minutes;
  - with it, `ready` after 22.6 minutes, three quarters of it starting containers;
  - a real failure (train crashing in the image) ending `failed` at stage `train`;
  - a build killed during extract, restarted and finished: `ready`, with no duplicate rows and the cached beats reused.
- **Fixed during the run:** paths in the modeling package that assumed the repo layout, a vague failure message, garbled run IDs in Cloud Logging, and four deploy-script and YAML problems.
- **Next phases must keep:**
  - redeploy the images after code changes (`infra/deploy-pipeline.sh`);
  - Phase 11 fills in `job-publish`, which the workflow already runs;
  - the weekly refresh runs without `allow_small`, so the test channel will drop to `insufficient_data` on Monday.

### Phase 09: Evaluation and baselines (Oct 10, 2026)

- **Built:**
  - `soundcheck-modeling evaluate`:
    - holds out each channel's newest 20% (or, for small channels, each video in turn in a labelled check mode) and refits on the rest;
    - scores curve error, share-watched error, drop-offs found and ranking against B0 (channel average), B1 (Gemini's generic guess, from the new `soundcheck baseline-llm`) and B2 (no content features);
    - checks 80% band coverage, with inflation fitted on validation videos;
    - runs a 2,000-resample bootstrap against B0;
    - writes `eval_runs`, Experiments runs and plots.
  - `soundcheck-modeling model-card` writes `docs/model-card.md`.
- **Real data:** check mode on the 3-video channel, the Gemini baseline costing $0.047.
  - The model is close on the two covers but far off on the application video.
  - B2 beats it for newcomers, which is overfitting from 2 training videos.
  - The card says "No result yet".
- **Model gate: not passed.** No channel has the 38+ usable videos a held-out test needs. The next step is recruiting at least 2 channels with 40+ videos, then rerunning features, fit, baseline-llm, evaluate and model-card.
- **Next phases must keep:**
  - no UI before a real number, unless Nishchay overrides it explicitly;
  - publish only `usable` models, and never present `check` evaluations as results;
  - apply a holdout's inflation factor to the bands the product shows.

### Phase 08: The audience model (Oct 10, 2026)

- **Built:**
  - **The contract:** the model artifact in zod; `pnpm gen:schemas` exports it for Python with the model's columns.
  - **The Python fitter:** a penalized fractional logistic hazard model with an analytic gradient and Hessian, cross-validation by video, a pooled prior, and the Laplace covariance scaled by the quasi-likelihood dispersion. It writes artifacts to GCS, rows to `model_runs`, and runs to Vertex AI Experiments.
  - **The TypeScript runtime:** predictions, survival, and sampled 10–90% bands.
  - **Traits:** `soundcheck traits` edits beats in 19 scenarios and reports the change in viewers still watching at the end, with a 90% interval.
  - **Estimated audiences,** with the spec's rule for when to show them.
- **Verified:**
  - recovery of known coefficients within 0.02;
  - TypeScript/Python parity to 6.2e-17;
  - honest coefficient spread with the production weights;
  - covariance reproduced over 20,000 draws;
  - 12 runs visible in Experiments.
- **Real data (`hazard-v2`):** pooled and channel models for all, subscribed and unsubscribed converged. All are marked not usable (3 videos; the pooled models cover 1 channel). The traits are mostly "can't tell yet".
  - Sanity read: "Payoff timing looks right; on-screen text is misleading (it's just the end screen); the rest can't be judged from 3 videos."
- **Changed from the spec:**
  - the covariance is scaled by the dispersion (the spec's was about 140 times too wide);
  - models train on 28 or 49 configured columns;
  - artifacts gain the channel context, a `usable` flag and other fields;
  - `model_runs` gets an `audience` column;
  - a new `feature_contexts` table.
- **Data gate still not met:** 1 channel, 3 videos.
- **Next phases must keep:**
  - never ship `usable: false`;
  - predictions use `artifact.channelContext`;
  - Phase 09 checks the bands' calibration on held-out videos;
  - on-screen text is confounded with end screens.

### Phase 07: Timeline and training table (Oct 10, 2026)

- **Built:**
  - `@soundcheck/core/features`: the feature spec (86 columns; `FEATURE_VERSION` `feat-bf1e3064fa6f` is its hash), a B-spline basis checked against scipy, and `buildBins`, which turns a video's beats into a 100-bin frame for training and prediction;
  - `soundcheck features --channel …`, which writes `training_bins` (hazard label, viewers at risk, views, `x`) and `feature_specs`;
  - `soundcheck-modeling eda`, which writes `docs/eda/<version>/`.
- **Real data:** 900 rows (3 videos × 3 audiences × 100 bins). All hazards match `retention_curves`, and a re-run skips the write.
- **EDA:** `before_payoff` correlates most with hazard for every audience (+0.17 to +0.29). With 3 videos that mostly tells the videos apart; 37 of 86 columns never vary.
- **Changed from the spec:**
  - `framing` became `visual` shares and the talking-head features;
  - transforms are stored (`log1p_*`, `has_open_loop`);
  - `log_duration` dropped;
  - clustered, not partitioned;
  - features refuse an extraction version that hasn't passed the gate.
- **Data gate still not met:** 1 channel, 3 videos.
- **Next phases must keep:**
  - the model reads columns by name from `feature_specs`;
  - columns that never vary are handled before standardizing;
  - the channel context is stored with each model for predictions;
  - `soundcheck features` is re-run after any spec change.

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
