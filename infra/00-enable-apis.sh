#!/usr/bin/env bash
# Enables every Google API Soundcheck uses. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

# Beyond the spec's list: iam and cloudresourcemanager (service accounts and
# project IAM, 01), firebaserules (deploying firestore.rules, 04) and
# billingbudgets (the budget, 07).
APIS="
  run workflows workflowexecutions eventarc pubsub
  bigquery storage firestore cloudkms secretmanager
  artifactregistry cloudbuild aiplatform logging
  youtube youtubeanalytics youtubereporting
  iam cloudresourcemanager firebaserules billingbudgets
"

# One request accepts at most 20 services, so enable in batches of 10.
batch=""
count=0
total=0
for api in $APIS; do
  batch="$batch ${api}.googleapis.com"
  count=$((count + 1))
  total=$((total + 1))
  if [[ $count -eq 10 ]]; then
    # shellcheck disable=SC2086 # word splitting is intended
    gcloud services enable $batch --project="$PROJECT_ID"
    batch=""
    count=0
  fi
done
if [[ -n "$batch" ]]; then
  # shellcheck disable=SC2086
  gcloud services enable $batch --project="$PROJECT_ID"
fi
log "enabled ${total} APIs"
