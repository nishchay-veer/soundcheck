#!/usr/bin/env bash
# Builds the web app (UI and API) with Cloud Build and deploys it as the Cloud
# Run service soundcheck-web (Phase 11), running as sa-web.
#
#   infra/deploy-web.sh              # build the image and deploy
#   infra/deploy-web.sh --no-build   # redeploy the last image (config changes)
#
# The service is public: Google sign-in is the gate. Only the OAuth consent
# screen's test users can sign in, and every /api/v1 route needs a session.
# Configuration comes from the repo's .env (non-secret keys only); AUTH_SECRET
# and the OAuth client come from Secret Manager. Safe to re-run.
#
# Once, after the first deploy: add the redirect URI this prints to the OAuth
# client (Cloud console > APIs & Services > Credentials).
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

ROOT="$(cd "$INFRA_DIR/.." && pwd)"
SERVICE="soundcheck-web"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
LATEST="$INFRA_DIR/.last-web-image"
# Cloud Run's address for a service is fixed by its name, project number and region.
NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
URL="https://${SERVICE}-${NUMBER}.${REGION}.run.app"

if [[ "${1:-}" == "--no-build" ]]; then
  # shellcheck source=/dev/null
  source "$LATEST"
  log "reusing $WEB_IMAGE"
else
  WEB_IMAGE="${REGISTRY}/web:$(git -C "$ROOT" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
  gcloud builds submit "$ROOT" --project="$PROJECT_ID" --region="$REGION" \
    --config="$INFRA_DIR/cloudbuild/web.yaml" --substitutions="_IMAGE=${WEB_IMAGE}"
  log "built $WEB_IMAGE"
  printf 'WEB_IMAGE=%s\n' "$WEB_IMAGE" >"$LATEST"
fi

ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
env_yaml GCP_PROJECT_ID GCP_REGION BQ_DATASET BQ_LOCATION GCS_RAW_BUCKET GCS_UPLOADS_BUCKET \
  GCS_MEDIA_BUCKET FIRESTORE_DATABASE KMS_KEY_NAME GEMINI_LOCATION GEMINI_MODEL \
  GEMINI_FLASH_MODEL GEMINI_VIDEO_MODE MIN_VIEWS MIN_TRAIN_VIDEOS WORKFLOW_CHANNEL_BUILD \
  >"$ENV_FILE"
# Auth.js builds its sign-in callback from this, never from .env's localhost.
printf 'AUTH_URL: "%s"\n' "$URL" >>"$ENV_FILE"
SECRET_ENV="AUTH_SECRET=auth-secret:latest,AUTH_GOOGLE_ID=oauth-client-id:latest,AUTH_GOOGLE_SECRET=oauth-client-secret:latest"

gcloud run deploy "$SERVICE" --project="$PROJECT_ID" --region="$REGION" --quiet \
  --image="$WEB_IMAGE" --service-account="$(sa_email sa-web)" --allow-unauthenticated \
  --port=8080 --cpu=1 --memory=1Gi --cpu-boost --concurrency=80 --timeout=60s \
  --min-instances=0 --max-instances=3 \
  --env-vars-file="$ENV_FILE" --set-secrets="$SECRET_ENV" >/dev/null
log "deployed $SERVICE: $URL"
log "OAuth client redirect URI (add once): ${URL}/api/auth/callback/google"
