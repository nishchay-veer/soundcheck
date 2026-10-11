#!/usr/bin/env bash
# What the channel build needs beyond the earlier scripts (Phase 10):
# - Cloud Scheduler, and a weekly job (Mondays 03:00 IST) that starts the
#   weekly_refresh workflow as sa-workflows;
# - sa-workflows may start workflow executions (weekly_refresh starts
#   channel_build) and run jobs that act as sa-pipeline;
# - the Compute Engine default service account, which Cloud Build uses, may
#   read the uploaded source, push images to the repo and write build logs.
# Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

gcloud services enable cloudscheduler.googleapis.com --project="$PROJECT_ID"
log "enabled cloudscheduler.googleapis.com"

grant_project "$(sa_member sa-workflows)" roles/workflows.invoker
retry gcloud iam service-accounts add-iam-policy-binding "$(sa_email sa-pipeline)" \
  --project="$PROJECT_ID" --member="$(sa_member sa-workflows)" \
  --role=roles/iam.serviceAccountUser --quiet >/dev/null
log "sa-pipeline: roles/iam.serviceAccountUser -> sa-workflows"

NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
BUILDER="serviceAccount:${NUMBER}-compute@developer.gserviceaccount.com"
retry gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location="$REGION" \
  --project="$PROJECT_ID" --member="$BUILDER" --role=roles/artifactregistry.writer --quiet >/dev/null
log "repo $AR_REPO: roles/artifactregistry.writer -> $BUILDER"
grant_project "$BUILDER" roles/logging.logWriter
# `gcloud builds submit` uploads the source to this bucket, and the builder
# must read it back. gcloud creates it on the first build; create it first on
# a fresh project so the grant has something to attach to.
SOURCE_BUCKET="${PROJECT_ID}_cloudbuild"
if ! gcloud storage buckets describe "gs://${SOURCE_BUCKET}" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${SOURCE_BUCKET}" --project="$PROJECT_ID" --location=US \
    --uniform-bucket-level-access >/dev/null
  log "created: gs://${SOURCE_BUCKET}"
fi
grant_bucket "$SOURCE_BUCKET" "$BUILDER" roles/storage.objectViewer

JOB="weekly-refresh"
URI="https://workflowexecutions.googleapis.com/v1/projects/${PROJECT_ID}/locations/${REGION}/workflows/weekly_refresh/executions"
ARGS=(--project="$PROJECT_ID" --location="$REGION" --schedule="0 3 * * 1"
  --time-zone="Asia/Kolkata" --uri="$URI" --http-method=POST
  --oauth-service-account-email="$(sa_email sa-workflows)"
  --message-body='{"argument": "{}"}')
HEADER="Content-Type=application/json"
if gcloud scheduler jobs describe "$JOB" --project="$PROJECT_ID" --location="$REGION" >/dev/null 2>&1; then
  # `update` names the headers flag differently from `create`.
  gcloud scheduler jobs update http "$JOB" "${ARGS[@]}" --update-headers="$HEADER" --quiet >/dev/null
  log "updated: scheduler job $JOB (Mondays 03:00 IST)"
else
  gcloud scheduler jobs create http "$JOB" "${ARGS[@]}" --headers="$HEADER" --quiet >/dev/null
  log "created: scheduler job $JOB (Mondays 03:00 IST)"
fi
