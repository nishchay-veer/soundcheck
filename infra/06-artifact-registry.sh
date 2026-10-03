#!/usr/bin/env bash
# Creates the Docker repository "soundcheck" for the web, pipeline and
# modeling images. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

if gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "exists: Artifact Registry repo $AR_REPO"
else
  gcloud artifacts repositories create "$AR_REPO" --repository-format=docker \
    --location="$REGION" --project="$PROJECT_ID" \
    --description="Soundcheck images: web, pipeline, modeling"
  log "created: Artifact Registry repo $AR_REPO ($REGION)"
fi
log "push images to ${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/<web|pipeline|modeling>"
