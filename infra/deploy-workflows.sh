#!/usr/bin/env bash
# Deploys the channel_build and weekly_refresh workflows (Phase 10), running as
# sa-workflows. MIN_TRAIN_VIDEOS comes from the repo's .env (20 if unset).
# Then set WORKFLOW_CHANNEL_BUILD=channel_build in .env so builds can start.
# Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

ROOT="$(cd "$INFRA_DIR/.." && pwd)"
MIN_TRAIN_VIDEOS="$(grep -E '^MIN_TRAIN_VIDEOS=' "$ROOT/.env" | tail -n1 | cut -d= -f2-)"
MIN_TRAIN_VIDEOS="${MIN_TRAIN_VIDEOS:-20}"

gcloud workflows deploy channel_build --project="$PROJECT_ID" --location="$REGION" \
  --source="$INFRA_DIR/workflows/channel_build.yaml" \
  --service-account="$(sa_email sa-workflows)" \
  --set-env-vars="MIN_TRAIN_VIDEOS=${MIN_TRAIN_VIDEOS}" --quiet >/dev/null
log "workflow channel_build (MIN_TRAIN_VIDEOS=${MIN_TRAIN_VIDEOS})"

gcloud workflows deploy weekly_refresh --project="$PROJECT_ID" --location="$REGION" \
  --source="$INFRA_DIR/workflows/weekly_refresh.yaml" \
  --service-account="$(sa_email sa-workflows)" \
  --set-env-vars="CHANNEL_BUILD_WORKFLOW=channel_build" --quiet >/dev/null
log "workflow weekly_refresh"
log "set WORKFLOW_CHANNEL_BUILD=channel_build in .env"
