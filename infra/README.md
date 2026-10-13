# Infra

Idempotent `gcloud`/`bq` scripts that build Soundcheck's Google Cloud environment. Every script checks before it creates, so running any of them twice is safe. They use the project from `gcloud config get-value project` (or `GCP_PROJECT_ID` if exported).

| Script                     | Creates                                                                                                                                                                                                                                                                                  |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-enable-apis.sh`        | Enables every API Soundcheck uses                                                                                                                                                                                                                                                        |
| `01-service-accounts.sh`   | `sa-web`, `sa-pipeline`, `sa-workflows`, `sa-eventarc` and their project-level roles                                                                                                                                                                                                     |
| `02-storage.sh`            | Buckets `{project}-raw`, `-uploads` (30-day delete, CORS `PUT` with `Range` readable, for chunked uploads), `-media`; bucket-level roles; `pubsub.publisher` for the Cloud Storage service agent (Eventarc). `WEB_ORIGIN=https://…` adds the production origin to CORS                   |
| `03-bigquery.sh`           | Dataset `soundcheck` (US), every table in `bigquery/*.sql`, then the migrations in `bigquery/migrations/*.sql`; `dataEditor` for `sa-pipeline` and `sa-web`                                                                                                                              |
| `04-firestore.sh`          | The `(default)` Firestore Native database in `us-central1`; releases `firestore.rules` (deny all client access)                                                                                                                                                                          |
| `05-kms.sh`                | Key ring `soundcheck`, key `oauth-tokens` (90-day rotation), key roles                                                                                                                                                                                                                   |
| `06-artifact-registry.sh`  | Docker repo `soundcheck` in `us-central1`                                                                                                                                                                                                                                                |
| `07-budget.sh`             | Monthly budget with alerts at 50%, 90% and 100%: `infra/07-budget.sh <BILLING_ACCOUNT_ID> <AMOUNT>`                                                                                                                                                                                      |
| `08-secrets.sh`            | Secrets `oauth-client-id`, `oauth-client-secret`, `auth-secret`; access for `sa-web` and `sa-pipeline`; generates `auth-secret`; loads the OAuth client JSON                                                                                                                             |
| `09-orchestration.sh`      | Cloud Scheduler and the `weekly-refresh` job (Mondays 03:00 IST, starts `weekly_refresh` as `sa-workflows`); `workflows.invoker` for `sa-workflows` and its use of `sa-pipeline`; Artifact Registry and logging roles for the Cloud Build service account (Phase 10)                     |
| `10-soundcheck-trigger.sh` | The Eventarc trigger `soundcheck-upload`: a finished object in `-uploads` starts the `soundcheck` workflow as `sa-eventarc` (Phase 14); run after `deploy-workflows.sh`                                                                                                                  |
| `deploy-pipeline.sh`       | Builds the pipeline and modeling images with Cloud Build (`cloudbuild/pipeline.yaml`) and deploys the 8 Cloud Run jobs of the channel build and `job-soundcheck`, with `.env`'s non-secret keys and the OAuth client from Secret Manager. `--no-build` redeploys the last images         |
| `deploy-workflows.sh`      | Deploys `workflows/channel_build.yaml`, `workflows/weekly_refresh.yaml` and `workflows/soundcheck.yaml` as `sa-workflows`; then set `WORKFLOW_CHANNEL_BUILD=channel_build` and `WORKFLOW_SOUNDCHECK=soundcheck` in `.env`                                                                |
| `deploy-web.sh`            | Builds the web app's image with Cloud Build (`cloudbuild/web.yaml`) and deploys the public Cloud Run service `soundcheck-web` as `sa-web`, with `.env`'s non-secret keys, `AUTH_URL` set to its address, and the auth secrets from Secret Manager. `--no-build` redeploys the last image |
| `up.sh`                    | Runs 00–06, 08 and 09 in order                                                                                                                                                                                                                                                           |
| `print-env.sh`             | Prints the `.env` lines that follow from the infra                                                                                                                                                                                                                                       |
| `local-auth-env.sh`        | Fills `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (from Secret Manager), a local `AUTH_SECRET` and `AUTH_URL` in `.env` for local sign-in; never prints values                                                                                                                                 |

Resource-scoped roles are granted by the script that creates the resource, so the order matters on a fresh project: run `up.sh`, or the scripts in number order.

## Before you start

1. Install the Google Cloud CLI (`brew install --cask google-cloud-sdk`), which includes `bq`. `jq`, `curl` and `openssl` must be on the path.
2. A project with billing linked. Your account needs Owner on the project (or the IAM, Service Account, Storage, BigQuery, Firestore, KMS, Secret Manager and Artifact Registry admin roles) and, for the budget, Billing Account Administrator or Costs Manager.
3. Log in and pick the project:

   ```sh
   gcloud auth login
   gcloud config set project <PROJECT_ID>
   gcloud auth application-default login     # for the Vertex smoke test and local SDKs
   ```

## Build everything

```sh
infra/up.sh
infra/07-budget.sh <BILLING_ACCOUNT_ID> <AMOUNT>   # e.g. 50, or 4000INR
infra/print-env.sh                                 # paste into the repo-root .env
infra/local-auth-env.sh                            # local sign-in values, written into .env
```

## Manual steps

These cannot be scripted.

### OAuth consent screen

Console → **Google Auth Platform** (APIs & Services → OAuth consent screen):

1. **Branding:** app name "Soundcheck", your support email, developer contact email.
2. **Audience:** user type **External**, publishing status **Testing**. Add every teammate and recruited creator as a **test user** (at most 100).
3. **Data access:** add the scopes `openid`, `email`, `profile`, `https://www.googleapis.com/auth/youtube.readonly` and `https://www.googleapis.com/auth/yt-analytics.readonly`.

Testing mode expires refresh tokens after 7 days, so run ingestion soon after a creator connects.

### OAuth client and secrets

1. Google Auth Platform → **Clients** → **Create client** → **Web application**, name `soundcheck-web`.
2. Authorized JavaScript origin `http://localhost:3000`; authorized redirect URI `http://localhost:3000/api/auth/callback/google`.
   After the first `deploy-web.sh`, also add the deployed app, which it prints: origin `https://soundcheck-web-<project number>.us-central1.run.app` and redirect URI `https://soundcheck-web-<project number>.us-central1.run.app/api/auth/callback/google`.
3. **Download JSON**, then load it into Secret Manager without the values ever appearing on screen:

   ```sh
   infra/08-secrets.sh ~/Downloads/client_secret_XXXX.json
   rm ~/Downloads/client_secret_XXXX.json
   ```

`auth-secret` is generated by `08-secrets.sh` the first time it runs.

### Gemini models and quota

1. Pick the current models from the Vertex AI model list (Console → Vertex AI → Model Garden, or the "Google models" page in the Vertex AI docs): one strong model for `GEMINI_MODEL` and one flash-tier model for `GEMINI_FLASH_MODEL`. Put both in `.env`.
2. Run the smoke test: `pnpm --filter @soundcheck/scripts vertex-smoke`.
3. Quota: Console → IAM & Admin → **Quotas & system limits**, filter by "Vertex AI API" and the chosen models, and request an increase where a per-project limit applies. Models on dynamic shared quota have no per-project limit to raise. Free Trial accounts cannot request quota increases at all; upgrade the billing account to Paid first (the remaining credit carries over).

## Permanent choices

- The Firestore database location (`us-central1`) can never change.
- KMS key rings and keys can never be deleted, only disabled; re-running `05-kms.sh` reuses them.
