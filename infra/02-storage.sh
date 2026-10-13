#!/usr/bin/env bash
# Creates the raw, uploads and media buckets and grants bucket-level roles.
# Optional: WEB_ORIGIN=https://soundcheck.example.com adds the production origin
# to the uploads CORS policy. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

ensure_bucket() {
  if gcloud storage buckets describe "gs://$1" --project="$PROJECT_ID" >/dev/null 2>&1; then
    log "exists: gs://$1"
  else
    gcloud storage buckets create "gs://$1" --project="$PROJECT_ID" \
      --location="$REGION" --default-storage-class=STANDARD \
      --uniform-bucket-level-access --public-access-prevention
    log "created: gs://$1"
  fi
  # Re-applied on every run so drift is corrected.
  gcloud storage buckets update "gs://$1" \
    --uniform-bucket-level-access --public-access-prevention >/dev/null
}

ensure_bucket "$RAW_BUCKET"
ensure_bucket "$UPLOADS_BUCKET"
ensure_bucket "$MEDIA_BUCKET"

# Uploaded cuts are deleted after 30 days; raw and media have no lifecycle.
gcloud storage buckets update "gs://$UPLOADS_BUCKET" \
  --lifecycle-file="$INFRA_DIR/storage/uploads-lifecycle.json" >/dev/null
log "gs://$UPLOADS_BUCKET: delete objects after 30 days"

# The browser PUTs uploads in chunks straight to a resumable session (Phase
# 14) and reads `Range` back to know how much arrived.
origins='"http://localhost:3000"'
if [[ -n "${WEB_ORIGIN:-}" ]]; then origins="$origins, \"$WEB_ORIGIN\""; fi
cors_file="$(mktemp)"
trap 'rm -f "$cors_file"' EXIT
cat >"$cors_file" <<JSON
[{"origin": [$origins], "method": ["PUT"], "responseHeader": ["Content-Type", "Content-Range", "Range"], "maxAgeSeconds": 3600}]
JSON
gcloud storage buckets update "gs://$UPLOADS_BUCKET" --cors-file="$cors_file" >/dev/null
log "gs://$UPLOADS_BUCKET: CORS PUT from $origins"

# sa-web uploads cuts, reads model artifacts for in-request simulation, and
# deletes a channel's objects in every bucket when the creator asks.
grant_bucket "$UPLOADS_BUCKET" "$(sa_member sa-web)" roles/storage.objectAdmin
grant_bucket "$RAW_BUCKET" "$(sa_member sa-web)" roles/storage.objectAdmin
grant_bucket "$MEDIA_BUCKET" "$(sa_member sa-web)" roles/storage.objectAdmin
# sa-pipeline reads and writes all three.
grant_bucket "$RAW_BUCKET" "$(sa_member sa-pipeline)" roles/storage.objectAdmin
grant_bucket "$UPLOADS_BUCKET" "$(sa_member sa-pipeline)" roles/storage.objectAdmin
grant_bucket "$MEDIA_BUCKET" "$(sa_member sa-pipeline)" roles/storage.objectAdmin

# Eventarc: Cloud Storage publishes object events to Pub/Sub through its service
# agent. The command pads the email with whitespace, so strip it.
gcs_agent="$(gcloud storage service-agent --project="$PROJECT_ID" | tr -d '[:space:]')"
grant_project "serviceAccount:${gcs_agent}" roles/pubsub.publisher
