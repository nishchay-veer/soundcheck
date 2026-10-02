# Phase 00: Turborepo, tooling and CLAUDE.md

Oct 3, 2026

The create-turbo `with-tailwind` starter is now the Soundcheck workspace: two apps, five packages and one Python service, all driven by `pnpm check`. There are no product features.

## Done when

| Item                                                   | Status       | Evidence                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm install && pnpm check` passes from a fresh clone | Done         | Copied only the files git would carry into an empty directory: `pnpm install`, `pnpm install --frozen-lockfile` and `pnpm check` passed with 18/18 tasks and 0 cached, Python venv built from scratch; both lockfiles unchanged                                                                         |
| `pnpm build` succeeds                                  | Done         | Next.js standalone build (`/`, `/api/healthz`) and the tsup bundle, in place and in the fresh copy                                                                                                                                                                                                      |
| Docker images build for web, pipeline and modeling     | Done         | All three build locally; each runs as a non-root user. Web serves `/` (200), `/api/healthz` and static CSS on port 8080. `pipeline ingest` prints "ingest: not implemented"; `ffprobe` present; every core runtime dependency resolves from the bundle. `modeling fit` and `evaluate` print their stubs |
| `pnpm dev` serves `/` and `/api/healthz`               | Done         | Both return 200 on http://localhost:3000; the compiled CSS contains the design-token utilities                                                                                                                                                                                                          |
| CI is green on the first push                          | **Deferred** | The CI workflow and the Husky/lint-staged hook were removed on request; plan step 9 is marked deferred                                                                                                                                                                                                  |
| `docs/notes/phase-00.md` written                       | Done         | This file                                                                                                                                                                                                                                                                                               |

## What exists

- **`apps/web`** (`@soundcheck/web`): Next.js 16, App Router in `src/app`, `output: "standalone"`, `transpilePackages` for core and ui.
  - Placeholder `/` page built from the design-system tokens and fonts.
  - `GET /api/healthz` returns `{ status: "ok", versions }`, validated by `healthzResponseSchema` in core.
  - shadcn/ui `components.json`.
- **`apps/pipeline`** (`@soundcheck/pipeline`): commander CLI `soundcheck` with six stub commands, one file each in `src/commands/`.
  - `shard(items, task?)` gives each task a contiguous, balanced slice.
  - tsup bundles `src/main.ts` to `dist/main.js`.
- **`packages/core`** (`@soundcheck/core`): just-in-time source package with `env`, `logger`, `retry`, `gcp` and `versions`.
  - `schemas/` holds `health.ts`. `features/`, `model/` and `data/` are empty placeholders so the subpath exports resolve.
- **`packages/ui`** (`@soundcheck/ui`): just-in-time source package with the shadcn `cn` helper and a `components.json` for the shadcn monorepo layout.
- **`packages/vitest-config`** (new): the shared Vitest config, with `unit` and `integration` projects, and the network guard.
- **`packages/eslint-config` and `packages/typescript-config`**: renamed to `@soundcheck/*`. Added a Node ESLint config and a `node.json` tsconfig.
- **`services/modeling`** (`@soundcheck/modeling`): a uv project on Python 3.12.
  - Typer CLI `soundcheck-modeling` with `fit` and `evaluate` stubs.
  - ruff, mypy strict, pytest with pytest-socket.
  - A `package.json` wraps uv, and a package `turbo.json` declares cache inputs.
- **Root:** `CLAUDE.md`, `.env.example`, `.node-version` (24), `.prettierrc.json` and `.dockerignore`. No CI workflow and no pre-commit hook (both deferred).
- **Deleted:** `apps/docs`, `packages/tailwind-config`, the starter components in `packages/ui`, and the starter SVGs and README in `apps/web`.

Tests: core 44, pipeline 12, ui 2, vitest-config 2, web 1, modeling 3.

## Changes from the spec

All approved before implementation. `docs/plan/overview.md` and `docs/plan/phase-00.md` were updated to match.

- **Versions follow the starter:** Next.js 16.3.6, TypeScript 7.0.2, pnpm 12.6.0, Node 24 everywhere (local, `.node-version`, `node:24-slim` images, tsup target `node24`).
  - CLAUDE.md rule 1 says Node 24.
  - TypeScript 7 is the native compiler with no JavaScript API. So `next build` skips type checking (`ignoreBuildErrors: true`), `pnpm check` runs `tsc --noEmit` instead, and ESLint keeps the TypeScript 6 API through `@typescript/typescript6`.
- **Redaction (rule 10):** any key ending in `token`, `secret` or `authorization` (any case, optional plural) at any depth.
  - pino's `redact` option only matches exact paths. A substring rule would also hide Gemini's `promptTokenCount` and `totalTokenCount`.
- **`withRetry`** reads the HTTP status from gaxios `response.status` and also from `status`, which is where `@google/genai` errors carry it. Socket errors (`ECONNRESET`, `ETIMEDOUT`) are not retried, as the spec says.
- **`env.ts`** adds `getJobEnv()` for `CLOUD_RUN_TASK_INDEX` and `CLOUD_RUN_TASK_COUNT`. This keeps `shard()` from reading `process.env` (rule 4) and lets it work without the full server env.
- **Vitest setup** lives in `packages/vitest-config`; `packages/config` never existed.
- **`packages/tailwind-config` is deleted.** Design tokens live in `apps/web/src/app/globals.css`, as the design system says, and the app moved from `apps/web/app` to `apps/web/src/app` to match.

## Notes for later phases

- **Imports:** all TypeScript uses `moduleResolution: "Bundler"` and imports with no file extension. No package compiles with `tsc`; Next.js, tsup, Vitest and tsx all read the source.
- **Core entry points:** the root export re-exports env, gcp, logger, retry and versions, and core has `"sideEffects": false`. Client components must import `@soundcheck/core/env` or `@soundcheck/core/schemas`, never the root, which pulls in pino and the Google Cloud clients.
- **Env:**
  - Every `.env.example` variable without a default is required, except `AUTH_URL` and `DEMO_CHANNEL_ID`, which are optional.
  - An empty assignment such as `GCP_REGION=` counts as unset.
  - A test checks that the schema and `.env.example` list the same variables.
  - `/` and `/api/healthz` never call `getEnv()`, so they work with no env set.
- **Logging:**
  - Use `childLogger(ctx)`, not `logger.child()`. pino skips the bindings formatter for child loggers, so `childLogger` redacts the context itself.
  - Errors are serialized and scrubbed inside the log formatter, and pino's `err` serializer is a pass-through. A GaxiosError's `config.headers.Authorization` never reaches a log line.
- **Retries:** p-retry 8 passes a context object to its callbacks and calls `onFailedAttempt` before `shouldRetry`, so the retry decision and the retry log both live in `shouldRetry`. Backoff is factor 2 from 1 s up to a 30 s cap, with jitter (×1–2), and at most 6 attempts even if a caller asks for more.
- **GCP clients:** `getBigQuery`, `getFirestore`, `getStorage`, `getKms`, `getWorkflowExecutions` (an `ExecutionsClient`, for starting workflow runs) and `getSecretManager`. Nothing is constructed until first use. `setClientOverride(name, fake)` and `resetClients()` are for tests.
- **Tests:**
  - A unit test that opens a TCP connection fails with `NetworkAccessError`; this includes localhost and fetch. Unix sockets still work.
  - Name real-network tests `*.integration.test.ts` (Vitest) or mark them `@pytest.mark.integration` (Python), and run them with `pnpm turbo run test:integration`.
- **pnpm 12 supply-chain policy:**
  - The policy rejects versions under a day old. Rather than add exemptions, I pinned the previous releases: `@google-cloud/firestore` 9.3.0, `pino` 10.3.1, `lucide-react` 1.49.0 and `@types/node` 24.19.0 (the 24 line, matching the runtime).
  - `allowBuilds` allows esbuild and denies protobufjs's postinstall, which is only a version check.
- **uv is pinned to 0.8.5** (your local version) in the modeling Dockerfile, and the build backend is `uv_build<0.9`. The latest uv is 0.12.x; to upgrade, bump both together. When CI returns, pin `astral-sh/setup-uv` to the same version.
- **Docker:**
  - Build web and pipeline from the repo root (`docker build -f apps/<app>/Dockerfile .`) and modeling from `services/modeling`.
  - The pipeline runtime installs production dependencies hoisted and with `--ignore-scripts`. The bundle inlines `@soundcheck/core` but leaves core's own dependencies external, so they must sit in `/app/node_modules`.
  - Image sizes: web 403 MB, modeling 300 MB, pipeline 1 GB (mostly ffmpeg and the Google Cloud clients).
  - The web image listens on `PORT=8080`.
- **UI:**
  - The design system's `--accent` (pink) has the same name as shadcn's semantic `accent`, so shadcn's accent surfaces will be pink.
  - `components.json` was written by hand to match `shadcn init`. Add primitives from `apps/web` with the shadcn CLI and they land in `packages/ui/src/components`.
- **Formatting:**
  - Prettier uses `printWidth: 100`, matching ruff.
  - Your two plan docs (`overview.md`, `design-system.md`) are not Prettier-formatted, and I left their formatting alone; `pnpm fmt` would reformat them.
- **`AGENTS.md`:** turbo 2.11 created this at the repo root when it detected an AI agent, and re-adds it on later runs. Commit it, or set `"agentGuidance": false` in `turbo.json` and delete it.
- **Skipped:** Turborepo remote caching (optional; needs a Vercel token). The root `README.md` still has the starter text.

## For the human

- My `git mv` of `apps/web/app` → `apps/web/src/app` staged four renames (`favicon.ico`, `globals.css`, `layout.tsx`, `page.tsx`). This breaks the no-staging rule. `git restore --staged apps/web` unstages them; nothing else is staged.
- Husky and lint-staged are removed, and `core.hooksPath` (which Husky had set) is unset, so commits run no hooks.
- Local Docker images `soundcheck-{web,pipeline,modeling}:phase00` remain from verification.
