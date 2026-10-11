# Phase 11: Serving layer and API contracts

Oct 11, 2026

Every screen now reads one ready-made Firestore document:

- the publish job (`soundcheck publish`, the last stage of every build) precomputes them: a channel summary with audience cards, a video list, and one page per video with real and predicted curves, beats and drop-offs, each drop-off attributed to content and captioned by Gemini with checked numbers;
- data functions and `/api/v1` routes serve them to the owner only, parsed by the same zod schemas the publish job writes with;
- fixtures mode serves saved copies without Google Cloud or sign-in, for building screens;
- the web app runs on Cloud Run, where the API answers in 55 ms at the 95th percentile.

The test channel's models are not usable (3 videos), so every document is stamped "not usable" and the screens must say "not a result yet".

**Built in seven reviewed commits:**

1. `Define the serving document contracts`
2. `Find drop-offs and explain them`
3. `Narrate drops and audiences with checked numbers`
4. `Publish screen documents to Firestore`
5. `Serve channel documents through data functions and routes`
6. `Deploy the web app to Cloud Run`
7. `Verify Phase 11 and write the notes`

## Done when

| Item                                                                           | Status | Evidence                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job-publish` writes every document for a real channel                         | Done   | Execution `job-publish-656zr` (Oct 11, 05:20 to 05:24 UTC) wrote the summary, the video list and all 3 video pages, each stamped with its run ID: "publish: 3 videos, 22 drop-offs (written)"                                                               |
| Every data function and route handler returns data that parses with its schema | Done   | Each data function parses the document before returning it, and each route returns what its function returns. Unit tests for all four functions and every route; live, every route answered 200 in fixtures mode and in 500 signed-in requests on Cloud Run |
| p95 latency under 150 ms on Cloud Run                                          | Done   | 55 ms over 499 requests to the 5 routes, measured by Cloud Run itself (request logs); 39 to 65 ms per route. See "Latency"                                                                                                                                  |
| Fixtures exported and fixtures mode works                                      | Done   | `export-fixtures` saved 7 documents (80 KB) to `apps/web/fixtures/`. With sign-in settings blanked and no Google credentials, `NEXT_PUBLIC_USE_FIXTURES=true pnpm dev` served every route and the `/app` page                                               |
| `docs/notes/phase-11.md` written                                               | Done   | This file                                                                                                                                                                                                                                                   |

**Also verified:**

- **The deployed app:** `https://soundcheck-web-513835636030.us-central1.run.app` answers `/api/healthz`, renders `/`, sends anonymous `/app` to sign-in, and answers anonymous or forged-cookie API calls with 401.
- **Sign-in on the deployed app:** with the origin and redirect URI added to the OAuth client, Nishchay signed in at the deployed address and saw the channel.
- **Re-runs:** a second `soundcheck publish` wrote nothing ("unchanged") and asked Gemini nothing.
- **`pnpm check`** passes all 20 tasks: core 523 tests, pipeline 172, web 34, modeling 63.

## Live run

All on Oct 11, 2026, for the channel `UC-BHlgFbFh3V76yth-XCmlw`.

1. **`soundcheck publish` from this machine:** 3 videos, 22 drop-offs; 4 Gemini calls (the channel's cards and headline, one per video) of 4,753 tokens in all, none falling back to a template. A re-run: unchanged, nothing written, no Gemini calls.
2. **`export-fixtures`:** 7 documents. The channel's encrypted token is replaced by `"fixture"`, and the fixture user owns it.
3. **`infra/deploy-web.sh`:** image `web:b527ac1-20261011103059`, service `soundcheck-web`.
4. **`apps/web/scripts/measure-latency.ts`:** run tag `lt=fcd378b2`, 05:09 to 05:13 UTC.
5. **`infra/deploy-pipeline.sh`**, then `job-publish` run alone for the channel. The documents from step 1 were identical, so I removed the `steps/publish` marker first to make the job write rather than skip.

What the documents say:

- **Headline:** "Across 3 analyzed videos, Subscribers made up 21 percent of views with 46.8 percent average view, while Newcomers made up 79 percent with 51.3 percent."
- **Cards:** subscribers 21% of views and 24% of watch time; newcomers 79% and 76%. No traits: every interval still includes zero. No estimated audiences: the identifiability rule needs 30 videos.
- **Drop-offs:** 22 in all, 3 or 4 per video and audience. On both covers the largest is the opening seconds (bins 2 to 5, or 2 to 12 for the 4:22 cover's subscribers: 20 to 42 points), then two or three of 5 to 11 points, and on the 4:22 cover the end screen. The 88 s application video has none at its start; its largest are mid-video (12.2 points for newcomers, 9.5 for subscribers).
- **Attributions:** 43 to 100% unexplained. "Position in video" is the top named part of 13 drop-offs, "waiting for the payoff" of 1, and 8 have none: honest, from one training video per audience, and never put into captions while the models are not usable.
- **Bands:** at the middle of the 4:22 cover, newcomers' real share still watching (35.2%) is inside the predicted range (34.2 to 43.7%). The video is in the training data, so that is a fit, not a prediction (`inSample: true`).
- **Evaluation:** empty; there is no held-out result.

## Latency

Cloud Run's request logs, server side (from request received to response sent), after 5 warm-up requests per route; sequential requests, one instance.

| Route                                        | Requests | Median | p95   | Slowest |
| -------------------------------------------- | -------- | ------ | ----- | ------- |
| `GET /api/v1/me`                             | 100      | 46 ms  | 65 ms | 144 ms  |
| `GET /api/v1/channels/[id]`                  | 100      | 29 ms  | 42 ms | 118 ms  |
| `GET /api/v1/channels/[id]/summary`          | 100      | 30 ms  | 50 ms | 116 ms  |
| `GET /api/v1/channels/[id]/videos`           | 100      | 29 ms  | 39 ms | 60 ms   |
| `GET /api/v1/channels/[id]/videos/[videoId]` | 99       | 31 ms  | 41 ms | 104 ms  |
| **All**                                      | 499      | 31 ms  | 55 ms | 144 ms  |

- **From this machine** the same requests took about 350 ms (p95 460 to 660 ms): the round trip to us-central1.
- **`/me` is slowest:** it reads the user, then each channel, one after another. The others read the channel and the document together.
- **Cold starts are not in the table:** with no minimum instances, the first request after an idle spell took 3.4 s.
- One video request is missing from the logs (499 of 500).
- **To measure again:** `gcloud secrets versions access latest --secret=auth-secret | node apps/web/scripts/measure-latency.ts --user <Google ID> --channel UC… --video <ID>`. It signs a 10-minute session for that account in memory; the secret is piped in, never printed.

## Decisions

By Nishchay:

- **The plan, with eleven fixes:**
  1. documents from unusable models are written, stamped with the model's status; screens must say "not a result yet";
  2. the web app is deployed to Cloud Run, and latency is measured there from Cloud Run's own logs;
  3. fixtures mode has a fixed user and no sign-in, in development only;
  4. (asked separately) the fixtures hold the channel's real data;
  5. the drop-off attribution rule is defined (below);
  6. drop-offs are searched in bins 2 to 100;
  7. camelCase fields, and `subscribed`/`unsubscribed` as audience keys everywhere;
  8. beats carry `visual` and talking-head share instead of `framing`; no transcripts;
  9. estimated audience cards only when the overview's rule allows;
  10. a held-out evaluation's inflation factor widens the bands;
  11. publish skips unchanged documents and removes stale pages.
- **Fixtures:** real data, as exported (the repo must stay private or be shared knowingly).
- **`apps/web/AGENTS.md` and `CLAUDE.md`,** which `next dev` writes on every run, are git-ignored.

## Changes from the spec

All are recorded in `docs/plan/phase-11.md`.

- **Names:** camelCase throughout, as the existing documents are. Audience keys are `subscribed`, `unsubscribed`, `search`, `suggested` and `browse`, labelled "Subscribers", "Newcomers" and "Newcomers from …".
- **Dates** in the serving documents are ISO strings, so a route returns its document unchanged.
- **The model stamp:** every prediction and card carries `model {runId, usable, unusableReasons, trainedVideos}`; a card has no traits without a model.
- **The summary's evaluation** is one nullable block (`modelErrorPp`, `baselineErrorPp`, `beatsBaseline`, `testVideos`), filled only by a `holdout` evaluation of the models being published.
- **Drop-offs:** a bin counts when its 3-bin rolling loss is strictly above the video's 90th percentile and above 1.5 points; neighbouring windows merge, edge bins no steeper than the median are trimmed, and the 4 largest are kept per audience. Bin 1 is left out.
- **Attribution:** against the video's median-hazard bin, on the logit scale; only groups pushing the hazard up count; shares are parts of the measured excess, so the shares and the residual sum to 1; groups under 1% go to the residual; position terms form "Position in video"; the traffic mix never explains a drop-off.
- **Narration:**
  - the Gemini call, the checks and the cache live in `packages/core/src/gemini/narration.ts` (the pipeline has no `zod` dependency); the facts and templates are in `publish/narrate.ts`;
  - batched per video and per channel; cached in the raw bucket under `narration/`;
  - the checks: every number in the facts, a word limit, never "cohort";
  - with an unusable model, no causes or traits reach Gemini.
- **Trait statements** are templates from the simulated scenarios, e.g. "A 30 s sponsor read at 30%: -2.1 points still watching at the end".
- **Re-runs:** publish compares a hash of the finished documents with its step marker (`PUBLISH_VERSION` `serving-v1`), and writes video pages, then the list, then the summary, then removes stale pages.
- **Routes:** the channel and `/me` are `no-store` (they carry live build progress); the three document routes are `private, max-age=30`. A document not yet published is 404 `not_published`.
- **Fixtures mode:** documents at their Firestore paths under `FIXTURES_DIR`; writes (disconnect, start a build) answer 503; the app refuses to start with it in production; a "Fixture data" badge shows in the header.
- **Deployment** was not in the spec: `infra/deploy-web.sh` and `cloudbuild/web.yaml`.
- **The inflation factor** widens the published bands, not the traits' intervals.

## Incidents

- **Next.js copied the fixtures into the production build.** Its file tracer follows the fixture reader's runtime path. `outputFileTracingExcludes` and `.dockerignore` now keep them out of builds and images.
- **Narration needed three wording fixes before its first commit:**
  - every caption ended "This model is not reliable yet", which belongs on the screen, not on each caption;
  - "34.3 points of loss" became "34.3% of the subscribers who started";
  - a card caption ran to 34 words, over the limit of 30, and was rightly replaced by its template; captions now mention at most one trait.
- **A duplicate log key again:** narration bound `stage` under publish's `stage`, as in Phase 10; it now binds `step`.
- **Identical documents made the cloud job skip.** That is correct behaviour; I removed the step marker to see the job write.
- **My mistakes:**
  - test fixtures with made-up spline column names (`spline_1`; the real ones are `pos_b1`…);
  - a test reading a request through a second layer of JSON escaping;
  - in zsh, a loop variable named `path` replaced `PATH`, so my first fixtures-mode check ran no commands.

## Notes for later phases

- **Every screen must show "not a result yet"** while a document's `model.usable` is false, which is every document now. Evaluation numbers appear only with a held-out result.
- **Small-channel noise:** the test channel's subscriber curves move in steps of about 2 points, roughly one viewer each, so a subscriber "drop-off" can be one person. The opening seconds are usually the largest drop-off, and the end screen often appears; both are mostly "position in video".
- **Narration** writes the audience labels with capitals mid-sentence ("the Subscribers who started"). Fixing that in the prompt means bumping `NARRATION_PROMPT_VERSION`, which re-narrates every channel once (cents).
- **Fixtures:** re-run `pnpm --filter @soundcheck/scripts export-fixtures --channel UC…` after any change to the documents. They hold real analytics.
- **The deployed app:**
  - its origin and redirect URI are on the OAuth client, and sign-in works there;
  - with test users added on the consent screen, creators can connect without this machine, which unblocks recruiting (Phase 04);
  - Phase 14's uploads need the origin in the uploads bucket's CORS: `WEB_ORIGIN=https://soundcheck-web-513835636030.us-central1.run.app infra/02-storage.sh`;
  - with no minimum instances, a visit after an idle spell waits about 3 s. `--min-instances=1` removes that for demos, at a few dollars a month.
- **After the Monday refresh** the test channel's build becomes `insufficient_data` (Phase 10), but its documents stay from the last publish. Screens should read `build.state` as well as the documents.
- **Redeploy both:** code in `packages/core` reaches the web app with `deploy-web.sh` and the jobs with `deploy-pipeline.sh`.
