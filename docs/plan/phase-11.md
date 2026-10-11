# Phase 11 — Serving layer and API contracts

**Goal.** Everything the UI shows is precomputed into Firestore documents with stable, typed contracts, and the API exposes them. A frontend teammate can build every screen against fixtures before this phase finishes; draft the contracts below on Oct 6 for that reason.

**Depends on.** Phases 08 and 09. Day: Oct 11.

## Stack

- Next.js route handlers (Node runtime) and server-side data functions in `packages/core/src/data`
- zod v4 document schemas in `packages/core/src/schemas/documents.ts`; types via `z.infer`, no code generation
- Firestore; `@google/genai` (flash model) for narration at publish time

## Document contracts

All in `packages/core/src/schemas/documents.ts`, camelCase. Dates are ISO strings, so a route returns its document unchanged. Shares and survival are fractions; `…Pp` values are percentage points; bins run from 1 to 100.

- **ModelStamp:** `runId`, `usable`, `unusableReasons`, `trainedVideos`. It is on every prediction and card. A document from a model that is not usable is still published, and the screen must say "not a result yet".
- **`channels/{id}`:** the existing channel document. The browser sees `ChannelView`: `title`, `thumbnailUrl`, `subscriberCount`, `videoCount`, `status`, `connectedAt`, and `build {state, runId, mode, stage, startedAt, finishedAt, error, eligibleVideos, usableVideos, progress}`, never the token or the Workflows execution.
- **`channels/{id}/summary/current`:** `channelId`, `runId`, `generatedAt`, `videosAnalysed`, `beatsExtracted`, `headline`, `audiences` (AudienceCard list, one per key), and `evaluation`.
  - `evaluation` is `{runId, testVideos, modelErrorPp, baselineErrorPp, beatsBaseline}` for all viewers. It is null unless a `holdout` evaluation exists for the models being published.
- **AudienceCard:**
  - `key`: `subscribed` or `unsubscribed` (measured), or `search`, `suggested` or `browse` (estimated, shown only when the overview's rule allows);
  - `label`, `kind`, `viewShare`, `avgViewPct`;
  - `watchTimeShare` and `avgViewPct` are null for estimated audiences;
  - `traits`: at most 3, by absolute effect, each with an interval excluding zero: `{feature, statement, deltaPp, ci}`;
  - `description`: at most 30 words;
  - `model`: null without a fitted model, and then no traits.
- **`channels/{id}/index/videos`:** `channelId`, `runId`, `generatedAt`, and `videos [{videoId, title, publishedAt, durationS, thumbnailUrl, avgViewPct, biggestDrop {audience, atS, lossPp} | null, inSample}]`, newest first.
- **`channels/{id}/videos/{videoId}`:**
  - `title`, `publishedAt`, `durationS`, `thumbnailUrl`;
  - `stats {views, avdS, avp}` or null;
  - `audiences {subscribed?, unsubscribed?: {actual[100] | null, predicted {p10, p50, p90}[100] | null, model}}`;
  - `beats [{startS, endS, beatType, visual, talkingHeadShare, summary}]`;
  - `drops` (at most 4 per audience);
  - `inSample`.
- **Drop:** `audience`, `startS`, `endS`, `binStart`, `binEnd`, `actualLossPp`, `attributions [{group, label, share}]`, `residualShare` (the shares and the residual sum to 1), and `narrative`.
- **`soundchecks/{id}`** (written in Phases 14 and 15; a draft):
  - `channelId`, `status`, `progress`, `error`;
  - `input` is `{kind: "video", uri}` or `{kind: "script", text}`, each with `title` and `scenario`;
  - `durationS`, `beats`, `percentileVsChannel`, `edits`, `narrative`, `visualAssumed`, `createdAt`, `updatedAt`;
  - `prediction {audiences {subscribed?, unsubscribed?}, avdS, avp}`, with `avdS` and `avp` as `{p10, p50, p90}`.
- **Edit:**
  - `editId`, `op` (`remove`, `trim` or `move`), `beatIndex`, `label`, `rationale`, `audienceDriver`;
  - `params`: numbers by name; Phase 14 may tighten them;
  - `deltaAvpPp` and `deltaAvdS`, each `{p10, p50, p90}`.

## Build

1. **`publish/drops.ts`:** per video and measured audience, drop-offs on the measured curve.
   - A bin (2 to 100) counts when its 3-bin rolling loss is strictly above the video's 90th percentile and above 1.5 points.
   - Neighbouring windows merge, and edge bins that lose no more than the median bin are trimmed.
   - The 4 largest are kept.
2. **`publish/attribution.ts`:** each drop-off against the video's median-hazard bin, on the logit scale.
   - Each feature's push is `beta (x - x_ref) / sd`, from the runtime's `logitTerms`, averaged over the drop-off.
   - Pushes are summed into human groups: sponsor segment, branded intro, waiting for the payoff, no visual change, knowledge gap, long single beat, and so on. The spline, first-bin and time terms form "position in video". The traffic mix, constant within a video, never explains a drop-off.
   - Only groups pushing the hazard up count. Each share is its push over the measured excess, scaled down if the pushes exceed it.
   - The residual is the rest and always ships; groups under 1% go into it.
3. **Narration:**
   - `packages/core/src/gemini/narration.ts` sends Gemini's flash model only the facts (numbers formatted as they may be repeated, and labels), batched per video and per channel. A caption must:
     - use only numbers that are in its facts (a regex on digits);
     - fit its word limit;
     - never say "cohort".
   - A failing caption is asked for again once, with the reason, then replaced by its template. Templates pass the same checks.
   - Raw answers are archived; results are cached in the raw bucket by a hash of the facts, the model and `NARRATION_PROMPT_VERSION`.
   - `publish/narrate.ts` builds the facts and templates. With an unusable model, no causes or traits are given.
4. **`soundcheck publish --channel UC… [--force]`,** run as `job-publish` by the build's `publish` stage:
   - reads the catalogue, stats, curves, beats, the latest fitted models and the latest held-out evaluation;
   - predicts every eligible video's bands with `sampleCurves` (200 draws, widened by a holdout's inflation factor), marking training videos `inSample`;
   - computes traits on the typical training video, then drop-offs, attributions and captions;
   - parses each document with its schema, and writes the video pages, then the list, then the summary, in batches of at most 500, removing pages of videos no longer published;
   - skips the writes when a hash of the documents (without run ID and time) matches the `publish` step marker (`PUBLISH_VERSION`).
5. **Data functions** in `packages/core/src/data/screens.ts` (`getChannel`, `getSummary`, `listVideos`, `getVideo`, plus the existing `getMe`):
   - each checks ownership with `requireChannel` and reads its document at the same time;
   - another user's channel, or a malformed ID, is a NotFoundError;
   - a document not yet published is null.
6. **Routes** under `apps/web/src/app/api/v1/`, using the session through `lib/session.ts`:
   - `GET me` and `GET channels/[id]` are `no-store` (live build progress);
   - `GET channels/[id]/summary`, `GET channels/[id]/videos` and `GET channels/[id]/videos/[videoId]` are `private, max-age=30`;
   - a missing document is 404 `not_published`; someone else's channel is 404 `not_found`;
   - `POST channels/[id]/build` and `DELETE channels/[id]` stay as they were.
7. **Fixtures:**
   - `scripts/export-fixtures.ts` writes one channel's documents to `apps/web/fixtures/<Firestore path>.json`: the channel owned by `fixture-user` with no token, the fixture user, the summary, the list and every page, each checked first.
   - With `NEXT_PUBLIC_USE_FIXTURES=true` (development only; the app refuses to start with it in production), the data functions read fixtures from `FIXTURES_DIR` and `fixture-user` is signed in without Auth.js.
   - Writes answer 503, and the header shows "Fixture data".
   - Builds never include the fixtures.
8. **Deployment:** `infra/deploy-web.sh` builds the image (`cloudbuild/web.yaml`) and deploys the public Cloud Run service `soundcheck-web` as `sa-web`, with `AUTH_URL` set to its address. Add that origin and its `/api/auth/callback/google` redirect URI to the OAuth client once.
9. **Latency:** `apps/web/scripts/measure-latency.ts` signs a 10-minute session in memory from the deployed `AUTH_SECRET` (piped in) and times each route. The p95 comes from Cloud Run's request logs.
10. **Tests:**
    - drop detection on synthetic curves, with a property test;
    - attribution shares plus residual summing to 1;
    - the narration digit check rejecting an invented number;
    - `requireChannel` blocking another user's channel in every data function;
    - fixtures mode never reaching Firestore or writing.

## Do not

- Generate narration on a request path. It is written once at publish time.

## Done when

- [x] `job-publish` writes every document for a real channel
- [x] Every data function and route handler returns data that parses with its zod schema
- [x] p95 latency under 150 ms on Cloud Run
- [x] Fixtures exported and fixtures mode works
- [x] `docs/notes/phase-11.md` written
