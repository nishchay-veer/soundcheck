#!/usr/bin/env bash
# Creates the four service accounts and grants their project-level roles.
# Resource-scoped roles (buckets, dataset, key, secrets) are granted by the
# script that creates each resource. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

display_name() {
  case "$1" in
    sa-web) echo "Soundcheck web app and API" ;;
    sa-pipeline) echo "Soundcheck pipeline jobs (TypeScript and Python)" ;;
    sa-workflows) echo "Soundcheck Cloud Workflows" ;;
    sa-eventarc) echo "Soundcheck Eventarc triggers" ;;
  esac
}

for sa in sa-web sa-pipeline sa-workflows sa-eventarc; do
  if gcloud iam service-accounts describe "$(sa_email "$sa")" --project="$PROJECT_ID" >/dev/null 2>&1; then
    log "exists: $(sa_email "$sa")"
  else
    gcloud iam service-accounts create "$sa" --project="$PROJECT_ID" \
      --display-name="$(display_name "$sa")"
    log "created: $(sa_email "$sa")"
  fi
done

# sa-web: the Next.js app, which is also the API. jobUser lets
# DELETE /api/v1/channels/{id} run its BigQuery DELETE jobs.
grant_project "$(sa_member sa-web)" roles/datastore.user
grant_project "$(sa_member sa-web)" roles/workflows.invoker
grant_project "$(sa_member sa-web)" roles/bigquery.jobUser
# Signed upload URLs are signed by sa-web as itself.
retry gcloud iam service-accounts add-iam-policy-binding "$(sa_email sa-web)" \
  --project="$PROJECT_ID" --member="$(sa_member sa-web)" \
  --role=roles/iam.serviceAccountTokenCreator --quiet >/dev/null
log "sa-web: roles/iam.serviceAccountTokenCreator -> itself"

# sa-pipeline: the TypeScript and Python job images.
grant_project "$(sa_member sa-pipeline)" roles/bigquery.jobUser
grant_project "$(sa_member sa-pipeline)" roles/datastore.user
grant_project "$(sa_member sa-pipeline)" roles/aiplatform.user
grant_project "$(sa_member sa-pipeline)" roles/logging.logWriter

# sa-workflows: runs jobs with overrides and writes progress.
grant_project "$(sa_member sa-workflows)" roles/run.developer
grant_project "$(sa_member sa-workflows)" roles/logging.logWriter
grant_project "$(sa_member sa-workflows)" roles/datastore.user

# sa-eventarc: receives upload events and starts the soundcheck workflow.
grant_project "$(sa_member sa-eventarc)" roles/eventarc.eventReceiver
grant_project "$(sa_member sa-eventarc)" roles/workflows.invoker
# The Cloud Storage service agent's pubsub.publisher role is granted in
# 02-storage.sh, once the project has buckets.
