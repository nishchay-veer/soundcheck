#!/usr/bin/env bash
# The Eventarc trigger that starts a soundcheck when its upload finishes
# (Phase 14): every finished object in the uploads bucket starts the
# soundcheck workflow as sa-eventarc, which ignores objects that are not a
# soundcheck's upload (Eventarc cannot filter by prefix).
#
# Needs, from earlier scripts: the Eventarc and Pub/Sub APIs (00), sa-eventarc
# with eventReceiver and workflows.invoker (01), the Cloud Storage service
# agent's pubsub.publisher (02), and the soundcheck workflow
# (deploy-workflows.sh). The trigger lives where the bucket does. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

TRIGGER="soundcheck-upload"
if gcloud eventarc triggers describe "$TRIGGER" --project="$PROJECT_ID" --location="$REGION" \
  >/dev/null 2>&1; then
  log "exists: trigger $TRIGGER"
else
  retry gcloud eventarc triggers create "$TRIGGER" --project="$PROJECT_ID" --location="$REGION" \
    --destination-workflow=soundcheck --destination-workflow-location="$REGION" \
    --event-filters="type=google.cloud.storage.object.v1.finalized" \
    --event-filters="bucket=$UPLOADS_BUCKET" \
    --service-account="$(sa_email sa-eventarc)" --quiet >/dev/null
  log "created: trigger $TRIGGER (gs://$UPLOADS_BUCKET finalized -> workflow soundcheck)"
fi
