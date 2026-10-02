# Soundcheck build plan

Oct 1, 2026 · @Nishchay Veer

This is the spec every Claude Code session reads: what Soundcheck is, what the data allows, the architecture and the repo layout. The visual rules live in `docs/plan/design-system.md`, and each phase has its own file.

## What we're building, and what the data allows

Soundcheck learns how each of a creator's audiences actually watches, from their own back catalogue, then predicts how a new cut will perform before it is published and recommends edits with measured effect sizes. Every prediction ships with an uncertainty band, and the product publishes its own error rate against baselines.

The pipeline in one line: ingest measured retention curves, have Gemini segment every video into typed beats, align beats to the curve on a 100-bin timeline, fit a per-audience hazard model, validate on held-out videos, then simulate edits on new cuts.

### Measured vs inferred audiences

The YouTube Analytics retention report (dimension `elapsedVideoTimeRatio`) requires a single `video` filter and accepts only three optional filters: `subscribedStatus`, `audienceType` and `youtubeProduct` ([YouTube Analytics channel reports](https://developers.google.com/youtube/analytics/channel_reports)). There is no per-video retention curve by device or by traffic source. The product must be honest about which audiences are measured and which are estimated.

| Audience | How we get it | Shown as |
| --- | --- | --- |
| Subscribers | Own retention curve per video (`subscribedStatus==SUBSCRIBED`) | Measured |
| Newcomers (non-subscribers) | Own retention curve per video (`subscribedStatus==UNSUBSCRIBED`) | Measured |
| Organic only | Own curve (`audienceType==ORGANIC`); used only when ad views exceed 2% | Measured |
| Search, Suggested, Browse | Per-video traffic-source mix within newcomers, varied across the library, as interaction terms in the newcomer model | Estimated |
| Mobile, TV | Same method with the per-video device mix | Estimated (stretch) |

An estimated audience appears in the UI only when its share varies enough across the library to be identifiable (share standard deviation of at least 0.08 across at least 30 videos) and at least one of its effects has a confidence interval that excludes zero. Otherwise it is hidden, not guessed.

Note for Phase 03: YouTube announced a change to how views are counted on Aug 27, 2026. Read the [revision history](https://developers.google.com/youtube/reporting/revision_history) before ingesting and record any metric definitions that changed.

## Architecture and tech stack

Everything is TypeScript except the statistics. A Next.js app is both the UI and the API, a TypeScript pipeline runs as Cloud Run Jobs, and one small Python job fits and evaluates the models. BigQuery is the training warehouse; Firestore is the serving layer; no screen ever queries BigQuery.

### Language split

| Work | Language | Why |
| --- | --- | --- |
| UI, API route handlers, auth | TypeScript | One language and one set of types for the product |
| Ingestion, Gemini extraction, featurization, publish, soundcheck jobs | TypeScript | Official Node SDKs cover every Google API used: `googleapis`, `@google/genai`, `@google-cloud/*` |
| Prediction runtime and counterfactual search | TypeScript | Runs inside API requests; it is matrix products and sampling |
| Model fitting, evaluation, evaluation plots | Python | Penalized fitting with an analytic Hessian, bootstrap and calibration rely on numpy and scipy; Vertex AI Experiments has a first-class Python SDK; TypeScript has no mature equivalent |

The rule that keeps two languages honest: TypeScript computes every feature, including the spline basis, and writes the feature matrix to BigQuery. Python only reads that matrix, fits coefficients and writes a JSON model artifact whose schema is defined once in zod and exported as JSON Schema. A cross-language parity test (Phase 08) proves both sides predict identically.

### Stack by layer

| Layer | Choice | Why |
| --- | --- | --- |
| Monorepo | Turborepo, pnpm workspaces; the Python package joins through a `package.json` whose scripts call `uv` | One `pnpm check` runs lint, typecheck and tests in both languages, with caching |
| Web and API | Next.js 16 (App Router, standalone output) on Cloud Run; route handlers are the API | No second service to secure; secrets stay server-side; shared types |
| UI | Tailwind v4, shadcn/ui, SWR | Fast to build, accessible defaults |
| Charts | D3 scales and shapes, hand-rendered SVG in React | The retention curve and beat strip must share one x scale |
| Auth | Auth.js v5, Google provider, YouTube read scopes, offline access | One consent gives sign-in and a refresh token |
| Contracts | zod v4 in `packages/core`; `z.toJSONSchema` for Gemini and Python | One definition for every boundary |
| Batch | TypeScript CLI (Node 24) as Cloud Run Jobs, bundled with tsup; one image | Long runs, task sharding via `CLOUD_RUN_TASK_INDEX` |
| Modeling | Python 3.12 Cloud Run Job: numpy, scipy, matplotlib, jsonschema | Fit, evaluate, plot; nothing else |
| Orchestration | Cloud Workflows; Eventarc for upload events | Declarative DAG with retries across both job images |
| Warehouse | BigQuery (US multi-region) | Training tables, eval history, SQL analysis |
| Serving store | Firestore Native | One document read per screen |
| Files | Cloud Storage: raw API JSON, uploads, generated media | Raw responses archived so features can be rebuilt without re-fetching |
| Video understanding | Gemini on Vertex AI via `@google/genai` (`vertexai: true`), structured output | Reads YouTube URLs and `gs://` video directly |
| Narration | Gemini flash tier, numbers in, prose out, digit-checked | Sentences without invented figures |
| Experiment tracking | Vertex AI Experiments, from the Python job | Every training and eval run logged |
| Generation (stretch) | Imagen on Vertex AI; Veo optional | Thumbnail compositions; B-roll for flagged dead stretches |
| Secrets | Cloud KMS for refresh tokens, Secret Manager for app secrets | Per-user tokens encrypted at rest |
| Logging and delivery | pino JSON logs in Cloud Logging format; Artifact Registry, Cloud Build, budget alerts | Standard, scriptable |

Region: `us-central1` for compute and storage, BigQuery `US`, Gemini through the location in `GEMINI_LOCATION` (default `global`). One region avoids cross-region surprises and has the widest model availability.

Deliberately not in the core model: Video Intelligence and Speech-to-Text. Back-catalogue videos cannot be downloaded, so those features would exist at prediction time but never at training time. Training–serving skew would silently corrupt every prediction. They may appear in the UI as display-only enrichment for uploaded cuts.

### The four request paths

1. **Connect.** Browser → Auth.js consent → Next.js server encrypts the refresh token with KMS and stores it in Firestore → starts the `channel_build` workflow.
2. **Channel build (hours, unattended).** The workflow runs TypeScript jobs ingest → extract → features, the Python jobs train → evaluate, then the TypeScript publish job. Each writes progress to Firestore.
3. **Read a screen.** A server component calls a data function in `packages/core` → one Firestore document → zod-validated data. Client components reach the same functions through route handlers.
4. **Soundcheck a new cut (minutes).** Browser uploads to a signed GCS URL → Eventarc → `soundcheck` workflow → one TypeScript job extracts, predicts and searches edits → Firestore. Edit toggles call a route handler that simulates in-process from cached coefficients.

## Repository layout

One Turborepo, adapted from the starter you already initialized. Featurization and the prediction runtime live only in `packages/core`, imported by the web app and the pipeline, so training data and live predictions come from the same code.

```
soundcheck/                    Turborepo + pnpm workspaces
  turbo.json  pnpm-workspace.yaml  package.json  CLAUDE.md  .env.example
  apps/
    web/                       Next.js: UI and API route handlers (Cloud Run)
    pipeline/                  TypeScript CLI run as Cloud Run Jobs
      src/commands/            ingest, extract, consistency, features, publish, soundcheck
  packages/
    core/                      TypeScript, just-in-time internal package
      src/env.ts  logger.ts  retry.ts  gcp.ts  versions.ts
      src/schemas/             zod contracts: beats, documents, model artifact, BigQuery rows
      src/youtube/  src/gemini/  src/data/
      src/features/            timeline binning and spline basis (training AND prediction)
      src/model/               runtime, sampling, effects, counterfactuals
      src/stats/               agreement metrics (kappa), small numeric helpers
      src/prompts/             versioned Gemini prompts and few-shot examples
    ui/                        shared React components (from the starter)
    eslint-config/  typescript-config/   (from the starter)
    vitest-config/             shared Vitest preset; blocks network in unit tests
  services/
    modeling/                  Python (uv): fit and evaluate only; package.json wraps uv
  infra/                       gcloud scripts, BigQuery DDL, workflows YAML, firestore.rules
  scripts/                     probes, EDA, fixture export (run with tsx)
  docs/plan/  docs/notes/  docs/model-card.md
  tests/fixtures/              recorded API responses
```
