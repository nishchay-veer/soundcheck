# Status

Handoff log: one short entry per phase, newest first. Details live in `docs/notes/phase-NN.md`.

## Entries

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
