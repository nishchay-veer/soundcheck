# Shared setup for the infra scripts. Sourced, never run directly.
# Works with macOS bash 3.2 and Cloud Shell bash 5.
# shellcheck disable=SC2034 # the variables below are used by the sourcing scripts
set -euo pipefail

REGION="us-central1"
BQ_LOCATION="US"
BQ_DATASET="soundcheck"
FIRESTORE_DATABASE="(default)"
KMS_KEYRING="soundcheck"
KMS_KEY="oauth-tokens"
AR_REPO="soundcheck"
SECRETS="oauth-client-id oauth-client-secret auth-secret"

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

PROJECT_ID="${GCP_PROJECT_ID:-$(gcloud config get-value project 2>/dev/null || true)}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "No project set. Run 'gcloud config set project <PROJECT_ID>' or export GCP_PROJECT_ID." >&2
  exit 1
fi

RAW_BUCKET="${PROJECT_ID}-raw"
UPLOADS_BUCKET="${PROJECT_ID}-uploads"
MEDIA_BUCKET="${PROJECT_ID}-media"
KMS_KEY_NAME="projects/${PROJECT_ID}/locations/${REGION}/keyRings/${KMS_KEYRING}/cryptoKeys/${KMS_KEY}"

sa_email() { echo "$1@${PROJECT_ID}.iam.gserviceaccount.com"; }
sa_member() { echo "serviceAccount:$(sa_email "$1")"; }

log() { printf '[%s] %s\n' "$(basename "$0" .sh)" "$*" >&2; }

# Retries a command with backoff: new service accounts take a while to become
# visible to IAM, and concurrent policy edits fail on a stale etag.
retry() {
  local attempt=1 delay=5
  until "$@"; do
    if [[ $attempt -ge 6 ]]; then
      log "giving up after $attempt attempts: $*"
      return 1
    fi
    log "attempt $attempt failed; retrying in ${delay}s"
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

# grant_project <member> <role>
grant_project() {
  retry gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="$1" --role="$2" --condition=None --quiet >/dev/null
  log "project: $2 -> $1"
}

# grant_bucket <bucket> <member> <role>
grant_bucket() {
  retry gcloud storage buckets add-iam-policy-binding "gs://$1" \
    --member="$2" --role="$3" --quiet >/dev/null
  log "gs://$1: $3 -> $2"
}

log "project ${PROJECT_ID}"
