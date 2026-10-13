#!/usr/bin/env bash
# Builds the pipeline (TypeScript) and modeling (Python) images with Cloud
# Build, pushes them to Artifact Registry, and deploys the Cloud Run jobs the
# channel_build workflow runs (Phase 10). Every job runs as sa-pipeline; the
# workflow sets CHANNEL_ID, RUN_ID and BUILD_MODE on each execution.
#
#   infra/deploy-pipeline.sh              # build both images, deploy every job
#   infra/deploy-pipeline.sh --no-build   # redeploy the jobs on the last images
#
# Configuration comes from the repo's .env (non-secret keys only); the OAuth
# client comes from Secret Manager. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

ROOT="$(cd "$INFRA_DIR/.." && pwd)"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}"
LATEST="$INFRA_DIR/.last-images"

if [[ "${1:-}" == "--no-build" ]]; then
  # shellcheck source=/dev/null
  source "$LATEST"
  log "reusing $PIPELINE_IMAGE and $MODELING_IMAGE"
else
  TAG="$(git -C "$ROOT" rev-parse --short HEAD)-$(date +%Y%m%d%H%M%S)"
  PIPELINE_IMAGE="${REGISTRY}/pipeline:${TAG}"
  MODELING_IMAGE="${REGISTRY}/modeling:${TAG}"
  gcloud builds submit "$ROOT" --project="$PROJECT_ID" --region="$REGION" \
    --config="$INFRA_DIR/cloudbuild/pipeline.yaml" --substitutions="_IMAGE=${PIPELINE_IMAGE}"
  log "built $PIPELINE_IMAGE"
  gcloud builds submit "$ROOT/services/modeling" --project="$PROJECT_ID" --region="$REGION" \
    --tag="$MODELING_IMAGE"
  log "built $MODELING_IMAGE"
  printf 'PIPELINE_IMAGE=%s\nMODELING_IMAGE=%s\n' "$PIPELINE_IMAGE" "$MODELING_IMAGE" >"$LATEST"
fi

# The jobs' environment: the non-secret keys of .env, as a YAML file so values
# with commas survive.
ENV_FILE="$(mktemp)"
trap 'rm -f "$ENV_FILE"' EXIT
KEYS="GCP_PROJECT_ID GCP_REGION BQ_DATASET BQ_LOCATION GCS_RAW_BUCKET GCS_UPLOADS_BUCKET
  GCS_MEDIA_BUCKET FIRESTORE_DATABASE KMS_KEY_NAME GEMINI_LOCATION GEMINI_MODEL
  GEMINI_FLASH_MODEL GEMINI_VIDEO_MODE GEMINI_PRICE_INPUT_PER_M GEMINI_PRICE_OUTPUT_PER_M
  MIN_VIEWS MIN_TRAIN_VIDEOS"
# shellcheck disable=SC2086 # KEYS is a word list
env_yaml $KEYS >"$ENV_FILE"
SECRETS="AUTH_GOOGLE_ID=oauth-client-id:latest,AUTH_GOOGLE_SECRET=oauth-client-secret:latest"

# deploy_job <name> <image> <args> <task timeout> <retries> <memory> <cpu> [parallelism]
deploy_job() {
  # macOS's bash 3.2 treats an empty array as unset under `set -u`, hence the
  # `${extra[@]+…}` form below.
  local extra=()
  if [[ "$2" == "$PIPELINE_IMAGE" ]]; then extra+=(--set-secrets="$SECRETS"); fi
  gcloud run jobs deploy "$1" --project="$PROJECT_ID" --region="$REGION" --quiet \
    --image="$2" --args="$3" --service-account="$(sa_email sa-pipeline)" \
    --tasks=1 --parallelism="${8:-1}" --task-timeout="$4" --max-retries="$5" \
    --memory="$6" --cpu="$7" --env-vars-file="$ENV_FILE" ${extra[@]+"${extra[@]}"} >/dev/null
  log "job $1 -> $3"
}

deploy_job job-ingest "$PIPELINE_IMAGE" "stage,ingest" 3600s 1 1Gi 1
deploy_job job-extract "$PIPELINE_IMAGE" "stage,extract" 3600s 2 1Gi 1 10
deploy_job job-extract-load "$PIPELINE_IMAGE" "stage,extract-load" 1800s 1 1Gi 1
deploy_job job-features "$PIPELINE_IMAGE" "stage,features" 1800s 1 2Gi 1
deploy_job job-baseline "$PIPELINE_IMAGE" "stage,baseline" 3600s 1 1Gi 1
deploy_job job-publish "$PIPELINE_IMAGE" "stage,publish" 900s 1 1Gi 1
deploy_job job-soundcheck "$PIPELINE_IMAGE" "soundcheck" 1800s 1 1Gi 1
deploy_job job-train "$MODELING_IMAGE" "stage,train" 3600s 1 4Gi 2
deploy_job job-evaluate "$MODELING_IMAGE" "stage,evaluate" 3600s 1 4Gi 2
log "deployed 9 jobs in $REGION"
