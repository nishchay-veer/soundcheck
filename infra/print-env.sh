#!/usr/bin/env bash
# Prints the .env lines that follow from the infra, ready to paste into .env.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

cat <<ENV
GCP_PROJECT_ID=${PROJECT_ID}
GCP_REGION=${REGION}
BQ_DATASET=${BQ_DATASET}
BQ_LOCATION=${BQ_LOCATION}
GCS_RAW_BUCKET=${RAW_BUCKET}
GCS_UPLOADS_BUCKET=${UPLOADS_BUCKET}
GCS_MEDIA_BUCKET=${MEDIA_BUCKET}
FIRESTORE_DATABASE=${FIRESTORE_DATABASE}
KMS_KEY_NAME=${KMS_KEY_NAME}
ENV
