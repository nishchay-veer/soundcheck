#!/usr/bin/env bash
# Creates the Secret Manager secrets the app needs, grants access, generates
# auth-secret, and (optionally) loads the OAuth client from its downloaded JSON.
# Secret values are piped straight into gcloud and never printed.
#
#   infra/08-secrets.sh                              # containers, access, auth-secret
#   infra/08-secrets.sh ~/Downloads/client_secret_XXXX.json   # also the OAuth client
#
# Safe to re-run: a secret only gets a new version when its value changed.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

CLIENT_JSON="${1:-}"

for secret in $SECRETS; do
  if gcloud secrets describe "$secret" --project="$PROJECT_ID" >/dev/null 2>&1; then
    log "exists: secret $secret"
  else
    gcloud secrets create "$secret" --project="$PROJECT_ID" \
      --replication-policy=user-managed --locations="$REGION"
    log "created: secret $secret"
  fi
done

grant_secret() {
  retry gcloud secrets add-iam-policy-binding "$1" --project="$PROJECT_ID" \
    --member="$2" --role=roles/secretmanager.secretAccessor >/dev/null
  log "secret $1: secretAccessor -> $2"
}
# The web app needs all three for Auth.js; the pipeline only needs the OAuth
# client to refresh creators' tokens.
for secret in $SECRETS; do grant_secret "$secret" "$(sa_member sa-web)"; done
grant_secret oauth-client-id "$(sa_member sa-pipeline)"
grant_secret oauth-client-secret "$(sa_member sa-pipeline)"

has_version() {
  [[ -n "$(gcloud secrets versions list "$1" --project="$PROJECT_ID" \
    --filter='state=ENABLED' --limit=1 --format='value(name)' 2>/dev/null)" ]]
}

if has_version auth-secret; then
  log "auth-secret already has a value"
else
  openssl rand -base64 32 | tr -d '\n' |
    gcloud secrets versions add auth-secret --project="$PROJECT_ID" --data-file=- >/dev/null
  log "auth-secret: generated a random value"
fi

if [[ -z "$CLIENT_JSON" ]]; then
  for secret in oauth-client-id oauth-client-secret; do
    has_version "$secret" || log "$secret has no value yet: re-run with the OAuth client JSON (see infra/README.md)"
  done
  exit 0
fi

if ! jq -e '.web.client_id and .web.client_secret' "$CLIENT_JSON" >/dev/null; then
  echo "$CLIENT_JSON is not a Web application OAuth client JSON (no .web.client_id)." >&2
  exit 1
fi

# load_secret <secret> <json field>
load_secret() {
  if has_version "$1" &&
    [[ "$(gcloud secrets versions access latest --secret="$1" --project="$PROJECT_ID")" == "$(jq -j ".web.$2" "$CLIENT_JSON")" ]]; then
    log "$1 already up to date"
    return
  fi
  jq -j ".web.$2" "$CLIENT_JSON" |
    gcloud secrets versions add "$1" --project="$PROJECT_ID" --data-file=- >/dev/null
  log "$1: loaded from $(basename "$CLIENT_JSON")"
}
load_secret oauth-client-id client_id
load_secret oauth-client-secret client_secret
