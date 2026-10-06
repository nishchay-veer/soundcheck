# Phase 01 — Google Cloud foundation

**Goal.** Every cloud resource Soundcheck needs exists, created by idempotent scripts checked into `infra/`, so the environment can be rebuilt from scratch in minutes.

**Depends on.** Phase 00. Day: Oct 1.

## Stack

- `gcloud` and `bq` CLIs, bash with `set -euo pipefail`
- Cloud Run and Cloud Run Jobs, Workflows, Eventarc, Pub/Sub (Eventarc transport), BigQuery, Cloud Storage, Firestore Native, Cloud KMS, Secret Manager, Artifact Registry, Cloud Build, Vertex AI, Cloud Logging, Cloud Billing budgets
- YouTube Data API v3, YouTube Analytics API, YouTube Reporting API
- `@google/genai` run with `tsx` for the Vertex smoke test

## Build

1. `infra/00-enable-apis.sh` enables: `run`, `workflows`, `workflowexecutions`, `eventarc`, `pubsub`, `bigquery`, `storage`, `firestore`, `cloudkms`, `secretmanager`, `artifactregistry`, `cloudbuild`, `aiplatform`, `youtube`, `youtubeanalytics`, `youtubereporting`, `logging`, plus `iam` and `cloudresourcemanager` (service accounts, project IAM), `firebaserules` (releasing `firestore.rules`) and `billingbudgets` (the budget) (all `.googleapis.com`).
2. `infra/01-service-accounts.sh` creates four service accounts with least privilege. It grants the project-level roles; each resource-scoped role (bucket, dataset, key, secret) is granted by the script that creates that resource, because the resource does not exist yet when 01 runs:
   - `sa-web` (the Next.js app, which is also the API): `datastore.user`; `bigquery.jobUser` and `bigquery.dataEditor` on the dataset (channel deletion, added in Phase 02); `storage.objectAdmin` on the uploads, raw and media buckets (raw and media added in Phase 02 for channel deletion); `iam.serviceAccountTokenCreator` on itself (signed URLs); `cloudkms.cryptoKeyEncrypterDecrypter` on the token key; `workflows.invoker`; `secretmanager.secretAccessor` on the three app secrets.
   - `sa-pipeline` (both the TypeScript and the Python job images): `bigquery.dataEditor` on the dataset, `bigquery.jobUser`, `storage.objectAdmin` on raw, uploads and media buckets, `datastore.user`, `cloudkms.cryptoKeyDecrypter` on the token key, `aiplatform.user`, `secretmanager.secretAccessor` on `oauth-client-id` and `oauth-client-secret`, `logging.logWriter`.
   - `sa-workflows`: `run.developer` (to execute jobs with overrides), `logging.logWriter`, `datastore.user` (progress writes).
   - `sa-eventarc`: `eventarc.eventReceiver`, `workflows.invoker`. Grant `pubsub.publisher` to the Cloud Storage service agent (in `02-storage.sh`, after the buckets exist).
3. `infra/02-storage.sh` creates three buckets in `us-central1`, uniform access, public access prevention enforced: `{project}-raw` (no lifecycle), `{project}-uploads` (delete after 30 days; CORS allowing `PUT` from the web origin and `http://localhost:3000`), `{project}-media`.
4. `infra/03-bigquery.sh` creates dataset `soundcheck` in `US` and applies DDL files from `infra/bigquery/`. Tables now (later phases add their own):
   - `channels` (channel\_id, user\_id, title, subscriber\_count, video\_count, connected\_at)
   - `videos` (channel\_id, video\_id, title, description, published\_at, duration\_s, content\_type, is\_live, category\_id, tags, thumbnail\_url, default\_language, eligible, exclusion\_reason, ingested\_at); cluster by channel\_id
   - `video_stats` (channel\_id, video\_id, subscribed\_status, views, estimated\_minutes\_watched, average\_view\_duration\_s, average\_view\_percentage, as\_of)
   - `video_traffic_mix` and `video_device_mix` (channel\_id, video\_id, subscribed\_status, raw\_type, bucket, views, share, as\_of)
   - `retention_curves` (channel\_id, video\_id, audience, bin, elapsed\_ratio, audience\_watch\_ratio, relative\_retention, started\_watching, stopped\_watching, total\_segment\_impressions, s\_mono, hazard, as\_of); cluster by channel\_id, video\_id
   - `retention_coverage`, `beats`, `extraction_runs`, `model_runs`, `eval_runs`, `quality_reports` with core columns plus a `details JSON` column
5. `infra/04-firestore.sh` creates the default Native database in `us-central1` and deploys `infra/firestore.rules` denying all client access (`allow read, write: if false;`). Only server SDKs touch Firestore.
6. `infra/05-kms.sh` creates key ring `soundcheck` and symmetric key `oauth-tokens` with 90-day rotation.
7. `infra/06-artifact-registry.sh` creates Docker repo `soundcheck` in `us-central1` (images: web, pipeline, modeling).
8. `infra/07-budget.sh` creates a budget with alerts at 50%, 90% and 100%; the billing account ID and amount are script arguments. Spend is measured before credits (`exclude-all-credits`), so alerts fire while free-trial credit pays the bill.
9. `scripts/vertex-smoke.ts` (run with `tsx`): creates `new GoogleGenAI({ vertexai: true, project, location: GEMINI_LOCATION })`, sends a one-line prompt to `GEMINI_MODEL`, and prints the reply and token usage. The human checks the current Vertex AI model list and fills `GEMINI_MODEL` and `GEMINI_FLASH_MODEL` in `.env`.
10. `infra/README.md` documents the manual steps that cannot be scripted:
    - OAuth consent screen: External, Testing, scopes `openid`, `email`, `profile`, `https://www.googleapis.com/auth/youtube.readonly`, `https://www.googleapis.com/auth/yt-analytics.readonly`; add every teammate and recruited creator as a test user.
    - OAuth web client with redirect URIs `http://localhost:3000/api/auth/callback/google` and the production URL; secrets stored in Secret Manager as `oauth-client-id`, `oauth-client-secret`, `auth-secret`.
    - Request a Gemini quota increase on day 1. (Not possible on a Free Trial billing account; deferred until the account is upgraded to Paid.)
11. `infra/08-secrets.sh` creates the three secrets, grants access, generates `auth-secret`, and loads the downloaded OAuth client JSON without printing values. `infra/up.sh` runs 00–06 and 08 in order; `infra/print-env.sh` prints the derived `.env` lines.

## Decisions and gotchas

- Every script checks for existence before creating, so running it twice is safe.
- Loading from a `us-central1` bucket into a `US` dataset is allowed; querying across BigQuery locations is not. Keep every dataset in `US`.
- Testing-mode OAuth caps you at 100 test users and expires refresh tokens after 7 days. Plan ingestion right after each creator connects.

## Do not

- Use the default compute service account for anything.
- Grant `roles/owner` or `roles/editor` to any service account.

## Done when

- [ ] Every script runs twice without error
- [ ] `bq ls soundcheck` lists the tables
- [ ] `scripts/vertex-smoke.ts` prints a Gemini reply
- [ ] OAuth client exists and secrets are in Secret Manager
- [ ] Budget alert configured
- [ ] `docs/notes/phase-01.md` written, including the model IDs chosen
