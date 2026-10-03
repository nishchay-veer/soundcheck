# Status

Handoff log: one short entry per phase, newest first. Details live in `docs/notes/phase-NN.md`.

## Entries

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
