#!/usr/bin/env bash
# Creates key ring "soundcheck" and the symmetric key "oauth-tokens" (90-day
# rotation) that encrypts users' refresh tokens, and grants key access.
# Key rings and keys can never be deleted, only disabled. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

kms_() { gcloud kms "$@" --location="$REGION" --project="$PROJECT_ID"; }

if kms_ keyrings describe "$KMS_KEYRING" >/dev/null 2>&1; then
  log "exists: key ring $KMS_KEYRING"
else
  kms_ keyrings create "$KMS_KEYRING"
  log "created: key ring $KMS_KEYRING ($REGION)"
fi

# First rotation 90 days from now (BSD date on macOS, GNU date elsewhere).
next_rotation="$(date -u -v+90d +%Y-%m-%dT%H:%M:%SZ 2>/dev/null ||
  date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)"

if kms_ keys describe "$KMS_KEY" --keyring="$KMS_KEYRING" >/dev/null 2>&1; then
  log "exists: key $KMS_KEY"
  if [[ -z "$(kms_ keys describe "$KMS_KEY" --keyring="$KMS_KEYRING" --format='value(rotationPeriod)')" ]]; then
    kms_ keys update "$KMS_KEY" --keyring="$KMS_KEYRING" \
      --rotation-period=90d --next-rotation-time="$next_rotation"
    log "key $KMS_KEY: set 90-day rotation"
  fi
else
  kms_ keys create "$KMS_KEY" --keyring="$KMS_KEYRING" --purpose=encryption \
    --rotation-period=90d --next-rotation-time="$next_rotation"
  log "created: key $KMS_KEY (rotates every 90 days)"
fi

grant_key() {
  retry kms_ keys add-iam-policy-binding "$KMS_KEY" --keyring="$KMS_KEYRING" \
    --member="$1" --role="$2" >/dev/null
  log "key $KMS_KEY: $2 -> $1"
}
# sa-web encrypts tokens at connect time; sa-pipeline only decrypts them.
grant_key "$(sa_member sa-web)" roles/cloudkms.cryptoKeyEncrypterDecrypter
grant_key "$(sa_member sa-pipeline)" roles/cloudkms.cryptoKeyDecrypter
