# Phase 01: Google Cloud foundation

Oct 4, 2026

Every cloud resource Soundcheck needs exists in project `soundcheck-510519`, created by idempotent scripts in `infra/`. `infra/up.sh` rebuilds the environment from scratch, and `infra/07-budget.sh` adds the budget.

## Done when

| Item                                                             | Status | Evidence                                                                                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every script runs twice without error                            | Done   | `up.sh` ran clean twice (00–06 and 08), with the second run reporting "exists" or "already" everywhere. `07-budget.sh` ran twice; the second run reported "exists". `08-secrets.sh` ran a third time with the OAuth JSON. The very first `up.sh` failed in 01; see "Incidents" |
| `bq ls soundcheck` lists the tables                              | Done   | All 12 tables listed, with the expected clustering                                                                                                                                                                                                                             |
| `scripts/vertex-smoke.ts` prints a Gemini reply                  | Done   | Both models replied through Vertex AI (location `global`), reading config from `.env`                                                                                                                                                                                          |
| OAuth client exists and secrets are in Secret Manager            | Done   | Web client `soundcheck-web` was created in the console. `oauth-client-id`, `oauth-client-secret` and `auth-secret` each have one enabled version (checked by metadata only; values never read)                                                                                 |
| Budget alert configured                                          | Done   | `soundcheck-soundcheck-510519`: ₹4,200 a month, this project only, spend before credits, alerts at 50%, 90% and 100%                                                                                                                                                           |
| `docs/notes/phase-01.md` written, including the model IDs chosen | Done   | This file                                                                                                                                                                                                                                                                      |

`pnpm check` passes all 20 tasks.

## Model IDs chosen

| Variable             | Model                   | Why                                                                                                                                                    |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GEMINI_MODEL`       | `gemini-3.8-flash`      | The newest GA flash model. GA keeps extraction reproducible across runs, and flash pricing keeps back-catalogue extraction well inside the $300 credit |
| `GEMINI_FLASH_MODEL` | `gemini-3.5-flash-lite` | GA, the cheapest tier; used for narration                                                                                                              |
| `GEMINI_LOCATION`    | `global`                | The default; widest model availability                                                                                                                 |

Considered and rejected:

- `gemini-2.5-pro`: its Vertex retirement is scheduled for around Oct 20, 2026.
- `gemini-3.1-pro-preview`: preview status, much higher cost.

If Phase 05's consistency check shows extraction needs a stronger model, change `GEMINI_MODEL` in `.env` and bump `EXTRACTION_VERSION`.

Smoke test output: `gemini-3.8-flash` replied "Yes, I can read your message clearly." (186 tokens, 165 of them thinking); `gemini-3.5-flash-lite` replied "Yes, I can read your message." (20 tokens).

## What exists

| Resource                                                                   | Details                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| APIs                                                                       | The 17 in the spec, plus `iam`, `cloudresourcemanager`, `firebaserules` and `billingbudgets`                                                                                                                                       |
| Service accounts                                                           | `sa-web`, `sa-pipeline`, `sa-workflows`, `sa-eventarc` with the spec's roles. No owner or editor roles; the default compute account is unused                                                                                      |
| Buckets (`us-central1`, uniform access, public access prevention enforced) | `soundcheck-510519-raw`; `-uploads` (30-day delete, CORS `PUT` from `http://localhost:3000`); `-media`                                                                                                                             |
| BigQuery                                                                   | Dataset `soundcheck` (US) with `channels`, `videos`, `video_stats`, `video_traffic_mix`, `video_device_mix`, `retention_curves`, `retention_coverage`, `beats`, `extraction_runs`, `model_runs`, `eval_runs` and `quality_reports` |
| Firestore                                                                  | `(default)`, Native mode, `us-central1`; `firestore.rules` (deny all clients) released through the Firebase Rules API                                                                                                              |
| KMS                                                                        | Key ring `soundcheck`, key `oauth-tokens`, `us-central1`, 90-day rotation (first rotation 2027-01-01)                                                                                                                              |
| Artifact Registry                                                          | Docker repo `us-central1-docker.pkg.dev/soundcheck-510519/soundcheck`                                                                                                                                                              |
| Secret Manager (`us-central1` replicas)                                    | `oauth-client-id` and `oauth-client-secret` (read by `sa-web` and `sa-pipeline`); `auth-secret` (generated; read by `sa-web`)                                                                                                      |
| OAuth (manual)                                                             | Consent screen: External, Testing, five scopes, `nishchayv.dev@gmail.com` as a test user. Web client `soundcheck-web`, redirect URI `http://localhost:3000/api/auth/callback/google`                                               |
| Budget                                                                     | See "Done when"                                                                                                                                                                                                                    |
| Local                                                                      | Repo-root `.env` (gitignored), filled from `infra/print-env.sh` plus the model IDs. ADC is logged in with quota project `soundcheck-510519`                                                                                        |

## Changes from the spec

All are recorded in `docs/plan/phase-01.md`.

- **Resource-scoped grants live in the resource's own script.** Buckets, dataset, key and secrets don't exist yet when `01` runs. Bucket roles are in `02`, dataset in `03`, key in `05`, secrets in `08`. The Cloud Storage service agent's `pubsub.publisher` role is in `02` too, after the buckets exist.
- **`secretmanager.secretAccessor` is granted per secret, not project-wide.** `sa-pipeline` only gets the two OAuth client secrets.
- **Four extra APIs.** `firebaserules` is needed because gcloud cannot deploy Firestore rules. `billingbudgets` is for the budget. `iam` and `cloudresourcemanager` are for service accounts and project IAM.
- **Extra scripts.** `08-secrets.sh` loads the downloaded OAuth JSON straight into Secret Manager without printing values. `up.sh` runs everything in order. `print-env.sh` prints the derived `.env` lines.
- **The budget counts spend before credits.** By default a budget subtracts credits, so on a Free Trial spend stays at zero and the alerts would never fire.
- **Smoke test is `scripts/vertex-smoke.ts`**, not `vertex_smoke.py`: Python is only allowed in `services/modeling`.
- **Gemini quota increase deferred.** Free Trial billing accounts cannot request quota increases; this needs an upgrade to Paid, which keeps the remaining credit.

## Incidents

- **The first `up.sh` run stopped in `01`.** The four service accounts and their project roles were created; then the Cloud Storage service agent grant failed six times with "does not exist".
  - Cause: `gcloud storage service-agent` prints the email padded with a newline and spaces, which made the member name malformed.
  - Fix: strip the whitespace, and move the grant into `02-storage.sh` after the buckets exist.
  - Nothing needed cleaning up; the rerun skipped what existed.
- **Auto mode blocked Claude from running `up.sh`**, because it grants IAM roles. The human ran every cloud-changing script with `!`. Claude ran only read-only checks, `print-env.sh` and the smoke test.

## Notes for later phases

- **Config:**
  - `infra/lib.sh` holds the names: region `us-central1`, dataset `soundcheck`, key ring and key, repo, secret names. Scripts take the project from `gcloud config` or `GCP_PROJECT_ID`.
  - `WEB_ORIGIN=https://… infra/02-storage.sh` adds the production origin to the uploads CORS policy. The production redirect URI must also be added to the OAuth client by hand.
- **`pickServerEnv(keys)` in `packages/core/src/env.ts`** validates only the named variables. Use it for scripts and probes that shouldn't need the full server env.
- **`scripts/` is a workspace (`@soundcheck/scripts`).** Its scripts load the repo-root `.env` through `tsx --env-file-if-exists=../.env`. `@google/genai` is pinned to 2.25.0, the newest release that passes pnpm's release-age policy; its install script (a no-op) is denied in `allowBuilds`.
- **BigQuery:**
  - The tables follow the spec's columns. The run and quality tables add `status`, timestamps, versions and a `details JSON` column.
  - Ingest tables (`videos`, `video_stats`, the mix tables, `retention_curves`) have no version column. The phase that writes `s_mono` and `hazard` should decide whether `FEATURE_VERSION` belongs on `retention_curves`.
  - zod row schemas (rule 3) arrive with the phases that write rows.
- **OAuth Testing mode:** at most 100 test users, and refresh tokens expire after 7 days. Add each creator's Google account as a test user before they connect.
- **Free Trial:**
  - It ends after 90 days or at $300. Billing then turns off and resources stop, with 30 days to upgrade before data may be deleted.
  - A budget only alerts; it never caps spend.
- **Permanent choices:** the Firestore location is permanent, and the KMS key can only be disabled, never deleted.
- **Local tooling:** `shellcheck` was run through Docker (`koalaman/shellcheck-alpine`); `infra/.shellcheckrc` makes it follow `lib.sh`. It is not part of `pnpm check`.
