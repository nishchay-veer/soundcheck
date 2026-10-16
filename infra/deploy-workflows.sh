#!/usr/bin/env bash
# Deploys the channel_build and weekly_refresh workflows (Phase 10) and the
# soundcheck workflow (Phase 14), running as sa-workflows. Then set
# WORKFLOW_CHANNEL_BUILD=channel_build and WORKFLOW_SOUNDCHECK=soundcheck in
# .env so builds and soundchecks can start.
# Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

gcloud workflows deploy channel_build --project="$PROJECT_ID" --location="$REGION" \
  --source="$INFRA_DIR/workflows/channel_build.yaml" \
  --service-account="$(sa_email sa-workflows)" --quiet >/dev/null
log "workflow channel_build"

gcloud workflows deploy weekly_refresh --project="$PROJECT_ID" --location="$REGION" \
  --source="$INFRA_DIR/workflows/weekly_refresh.yaml" \
  --service-account="$(sa_email sa-workflows)" \
  --set-env-vars="CHANNEL_BUILD_WORKFLOW=channel_build" --quiet >/dev/null
log "workflow weekly_refresh"

gcloud workflows deploy soundcheck --project="$PROJECT_ID" --location="$REGION" \
  --source="$INFRA_DIR/workflows/soundcheck.yaml" \
  --service-account="$(sa_email sa-workflows)" --quiet >/dev/null
log "workflow soundcheck"
log "set WORKFLOW_CHANNEL_BUILD=channel_build and WORKFLOW_SOUNDCHECK=soundcheck in .env"
