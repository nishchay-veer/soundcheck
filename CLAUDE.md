# Soundcheck

Soundcheck: predicts per-audience YouTube retention and recommends edits. Spec: `docs/plan/overview.md`; handoff: `docs/notes/STATUS.md`.

## Repo map

- `apps/web/`: Next.js UI and API route handlers (Cloud Run)
- `apps/pipeline/`: TypeScript CLI run as Cloud Run Jobs; `src/commands/` holds ingest, extract, consistency, features, publish, soundcheck
- `packages/core/`: just-in-time TypeScript package: env, logger, retry, gcp, versions
- `packages/core/src/schemas/`: zod contracts for beats, documents, model artifact, BigQuery rows
- `packages/core/src/youtube/`, `src/gemini/`, `src/data/`: API clients and screen data functions
- `packages/core/src/features/`: timeline binning and spline basis (training AND prediction)
- `packages/core/src/model/`: prediction runtime, sampling, effects, counterfactuals
- `packages/core/src/stats/`: agreement metrics (kappa), small numeric helpers
- `packages/core/src/prompts/`: versioned Gemini prompts and few-shot examples
- `packages/ui/`: shared React components (shadcn/ui primitives)
- `packages/eslint-config/`, `packages/typescript-config/`, `packages/vitest-config/`: shared tooling configs
- `services/modeling/`: Python (uv): fit and evaluate only; `package.json` wraps uv
- `infra/`: gcloud scripts, BigQuery DDL, workflows YAML, firestore.rules
- `scripts/`: probes, EDA, fixture export (run with tsx)
- `docs/plan/`, `docs/notes/`, `docs/model-card.md`: spec, phase notes, model card
- `tests/fixtures/`: recorded API responses

## Language split

TypeScript everywhere. Python only in `services/modeling`, which fits and evaluates models and never computes features.

## Commands

- `pnpm check`: lint, typecheck and unit tests in every workspace, TypeScript and Python
- `pnpm dev`: web app on http://localhost:3000
- `pnpm --filter @soundcheck/pipeline soundcheck <command>`: run a pipeline command from source
- `uv run ...` inside `services/modeling`: e.g. `uv run soundcheck-modeling fit`, `uv run pytest`
- `pnpm build`, `pnpm fmt`; `pnpm turbo run test:integration` for tests tagged as integration

## Rules

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
16. **Git:** never stage, commit, push, merge, rebase, stash or switch branches. Leave every change in the working tree; the human reviews and commits.
