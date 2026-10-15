# Phase 00 — Turborepo, tooling and CLAUDE.md

**Goal.** Adapt your existing Turborepo into Soundcheck's workspace: TypeScript apps and packages plus one Python package, all driven by `pnpm check` (`turbo run lint typecheck test`). Docker images build and CI is green. No features.

**Depends on.** Your initialized Turborepo. Day: Oct 1.

## Stack

- Turborepo 2, pnpm 12 workspaces, Node 24 LTS everywhere (local, CI, Docker images, tsup target)
- TypeScript 7 strict (native `tsc` for typechecking; ESLint keeps the TypeScript 6 API through `@typescript/typescript6`); ESLint 10 and Prettier through the starter's `eslint-config` and `typescript-config` packages; Vitest; fast-check
- Next.js 16 (App Router, `output: "standalone"`), Tailwind v4, shadcn/ui
- zod v4, pino, p-retry, p-limit, commander (pipeline CLI), tsup (bundling the pipeline), tsx (scripts)
- Python 3.12 with `uv`, ruff, mypy, pytest, pytest-socket (in `services/modeling` only)
- GitHub Actions; Docker with `turbo prune`

## Build

1. Adapt the starter. Keep `apps/web`, `packages/ui`, `packages/eslint-config`, `packages/typescript-config`. Delete `apps/docs` and `packages/tailwind-config` (design tokens live in `apps/web/src/app/globals.css`). Add `apps/pipeline`, `packages/core`, `services/modeling`, and add `services/*` to `pnpm-workspace.yaml`. Scope package names as `@soundcheck/*`.
2. `turbo.json` tasks:
   - `build`: `dependsOn: ["^build"]`, outputs `.next/**`, `!.next/cache/**`, `dist/**`.
   - `lint`, `typecheck`, `test`: no build dependency (core is just-in-time, see step 3).
   - `dev`: `cache: false`, `persistent: true`.
   - Declare build-affecting env vars (`NEXT_PUBLIC_*`) under `env` so the cache key includes them.
   - Root scripts: `check` = `turbo run lint typecheck test`; `dev`; `build`; `fmt`.
3. `packages/core` as a just-in-time internal package: `exports` point at TypeScript source (`".": "./src/index.ts"`, plus subpaths `./schemas`, `./features`, `./model`, `./data`). No build step. `apps/web/next.config.ts` sets `transpilePackages: ["@soundcheck/core", "@soundcheck/ui"]`. Create:
   - `src/env.ts`: zod-parsed server env (every variable in `.env.example`) behind a cached `getEnv()`, a separate client schema for `NEXT_PUBLIC_*`, and a job schema for `CLOUD_RUN_TASK_INDEX` and `CLOUD_RUN_TASK_COUNT` behind `getJobEnv()`.
   - `src/logger.ts`: pino with `messageKey: "message"`, a formatter that maps levels to Cloud Logging `severity`, redaction of every key ending in `token`, `secret` or `authorization` at any depth (pino's `redact` option only matches exact paths, and a substring match would hide Gemini's `*TokenCount` usage fields), and `childLogger(ctx)`.
   - `src/versions.ts`: `EXTRACTION_VERSION = "beats-v1"`, `FEATURE_VERSION = "feat-v1"`, `MODEL_VERSION = "hazard-v1"`.
   - `src/retry.ts`: `withRetry(fn, opts)` on p-retry. Retry on HTTP 429 and 5xx (gaxios `response.status`, or `status` on `@google/genai` errors) and gRPC codes 8 and 14; abort on anything else; jittered backoff; max 6 attempts; log each retry.
   - `src/gcp.ts`: lazy singletons for `@google-cloud/bigquery`, `@google-cloud/firestore`, `@google-cloud/storage`, `@google-cloud/kms`, `@google-cloud/workflows`, `@google-cloud/secret-manager`, with `setClientOverride()` for tests.
4. `apps/pipeline`: a commander CLI `soundcheck` with commands `ingest`, `extract`, `consistency`, `features`, `publish`, `soundcheck`, each printing "not implemented". Add `shard(items)` that returns this task's slice using `CLOUD_RUN_TASK_INDEX` and `CLOUD_RUN_TASK_COUNT` (defaults 0 and 1). tsup bundles `src/main.ts` to `dist/main.js` as ESM for Node 24 with `noExternal: [/^@soundcheck\//]`. Dockerfile: multi-stage with `turbo prune @soundcheck/pipeline --docker`, `pnpm install --frozen-lockfile`, build; runtime `node:24-slim` with `ffmpeg` installed (Phase 14 needs `ffprobe`); non-root user.
5. `apps/web`: Next.js 16 with `output: "standalone"`, Tailwind v4, shadcn/ui initialized, a placeholder `/` and `GET /api/healthz`. Dockerfile with `turbo prune @soundcheck/web --docker` and the standalone output.
6. `services/modeling`: a `uv` project (`pyproject.toml`, `uv.lock`) with package `soundcheck_modeling` and a Typer CLI with `fit` and `evaluate` stubs. Add a `package.json` named `@soundcheck/modeling` whose scripts call uv: `lint` = `uv run ruff check . && uv run ruff format --check .`; `typecheck` = `uv run mypy src`; `test` = `uv run pytest`. Add a package-level `turbo.json` with `inputs: ["src/**/*.py", "tests/**/*.py", "pyproject.toml", "uv.lock"]` so Turborepo caches it correctly. Dockerfile: `python:3.12-slim` with uv, non-root.
7. `.env.example`: `GCP_PROJECT_ID`, `GCP_REGION=us-central1`, `BQ_DATASET=soundcheck`, `BQ_LOCATION=US`, `GCS_RAW_BUCKET`, `GCS_UPLOADS_BUCKET`, `GCS_MEDIA_BUCKET`, `FIRESTORE_DATABASE=(default)`, `KMS_KEY_NAME`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET`, `AUTH_URL`, `GEMINI_LOCATION=global`, `GEMINI_MODEL`, `GEMINI_FLASH_MODEL`, `IMAGEN_MODEL`, `WORKFLOW_CHANNEL_BUILD`, `WORKFLOW_SOUNDCHECK`, `MIN_VIEWS=500`, `MIN_TRAIN_VIDEOS=8`, `DEMO_CHANNEL_ID`, `NEXT_PUBLIC_USE_FIXTURES=false`.
8. Write `CLAUDE.md`: exactly the content described in the CLAUDE.md section below (`pnpm check`, `pnpm dev`, `pnpm --filter @soundcheck/pipeline soundcheck <command>`, `uv run` inside `services/modeling`).
9. **Deferred for now** (removed on Oct 3, 2026): Husky and lint-staged for Prettier and ESLint on commit. A GitHub Actions workflow: set up pnpm, Node 24 and uv; `pnpm install --frozen-lockfile`; `pnpm check`. Optionally enable Turborepo remote caching.
10. One test per package. A Vitest setup file in `packages/vitest-config` makes any real network call fail in unit tests; Python uses pytest-socket. Integration tests are tagged and excluded from `pnpm check`.

## CLAUDE.md content

`CLAUDE.md` loads into every session automatically, so it holds only what every session needs, in this order:

1. **Project:** one line: "Soundcheck: predicts per-audience YouTube retention and recommends edits. Spec: `docs/plan/overview.md`; handoff: `docs/notes/STATUS.md`."
2. **Repo map:** the folder tree from the Overview, one line per folder.
3. **Language split:** "TypeScript everywhere. Python only in `services/modeling`, which fits and evaluates models and never computes features."
4. **Commands:** `pnpm check`, `pnpm dev`, `pnpm --filter @soundcheck/pipeline soundcheck <command>`, and `uv run ...` inside `services/modeling`.
5. **Rules:** the list below, word for word.

### Rules

1. TypeScript strict everywhere (`strict`, `noUncheckedIndexedAccess`), ESM, Node 24. ESLint and Prettier from the shared configs; Vitest for tests; fast-check for property tests.
2. Python lives only in `services/modeling`: Python 3.12 with `uv`, ruff, mypy strict, pytest with pytest-socket. It reads features and writes model artifacts. It never computes a feature.
3. Every value crossing a boundary (route response, Firestore document, BigQuery row, Gemini output, model artifact) has a zod schema in `packages/core/src/schemas`. Types come from `z.infer`. Python validates artifacts against the exported JSON Schema.
4. Config only through `packages/core/src/env.ts` (zod-parsed `process.env`). No `process.env` reads anywhere else. Client-safe values use the `NEXT_PUBLIC_` prefix and a separate schema.
5. Every external call (YouTube, Gemini, Vertex, Imagen) goes through `withRetry`: exponential backoff with jitter, retries only on HTTP 429 and 5xx or gRPC `UNAVAILABLE` and `RESOURCE_EXHAUSTED`, at most 6 attempts. Concurrency limits use p-limit.
6. Raw API responses are written to `gs://{project}-raw/{channel_id}/{source}/{video_id}/{yyyymmdd}.json` before parsing. Parsers are pure functions tested against recorded fixtures.
7. Every pipeline step is idempotent, keyed by channel, video, step and version. Re-running skips finished work. `EXTRACTION_VERSION`, `FEATURE_VERSION` and `MODEL_VERSION` live in `packages/core/src/versions.ts` and are stored on every row.
8. No outcome data as a feature. Anything derived from analytics (views, average view duration, rewatch bumps) is a label or a weight, never an input.
9. Gemini and Imagen model IDs come from env (`GEMINI_MODEL`, `GEMINI_FLASH_MODEL`, `IMAGEN_MODEL`). Never hardcode one.
10. Structured JSON logs via pino, formatted for Cloud Logging (`severity`, `message`), with child loggers bound to `channel_id`, `video_id`, `stage`, `run_id`. Redact any key ending in `token`, `secret` or `authorization`, at any depth.
11. No BigQuery on a request path. Screens are served from Firestore documents written by the publish job.
12. User-facing text says "audience"; code and schemas may say "cohort".
13. Any UI work follows `docs/plan/design-system.md`.
14. Ask before adding a dependency the phase does not list.
15. Each phase ends with `pnpm check` green, its "Done when" list verified, `docs/notes/phase-NN.md` written, and a short entry added to `docs/notes/STATUS.md`.
16. **Git:** work in small parts. After each part, show it for review and commit only when the human says "commit": stage just that part's files, one-line message, no AI attribution. Never push, merge, rebase, stash or switch branches.

Also create `docs/notes/STATUS.md` with a heading and an empty entry list, and add this phase's entry to it.

## Decisions and gotchas

- Just-in-time internal packages mean no build step for `packages/core`: Next.js transpiles it, tsup bundles it into the pipeline, and Vitest and tsx run it directly.
- Turborepo only runs the Python package's scripts; Python dependencies stay in `uv.lock`, never in pnpm.
- `turbo prune --docker` gives each image only the workspaces it needs, which keeps builds fast and images small.
- Versions follow the create-turbo starter rather than the first draft of this spec: Next.js 16, TypeScript 7, pnpm 12, Node 24. Next.js cannot load the native TypeScript 7 compiler, so `next build` skips type checking (`ignoreBuildErrors`) and `pnpm check` runs `tsc --noEmit` instead.

## Do not

- Create any cloud resource (Phase 01).
- Hardcode any Gemini or Imagen model name.
- Put Python anywhere except `services/modeling`.
- Build any product feature.

## Done when

- [ ] `pnpm install && pnpm check` passes from a fresh clone, covering TypeScript and Python
- [ ] `pnpm build` succeeds
- [ ] Docker images build for web, pipeline and modeling
- [ ] `pnpm dev` serves `/` and `/api/healthz`
- [ ] CI is green on the first push (deferred with step 9)
- [ ] `docs/notes/phase-00.md` written
