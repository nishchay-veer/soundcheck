#!/usr/bin/env bash
# Fills the Auth.js values in the repo-root .env for local development:
# AUTH_GOOGLE_ID and AUTH_GOOGLE_SECRET from Secret Manager, a fresh local
# AUTH_SECRET (never the production one) if none is set, and AUTH_URL.
# Values are written straight into .env and never printed. Safe to re-run.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

ENV_FILE="$INFRA_DIR/../.env"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "No .env at the repo root. Copy .env.example and paste in infra/print-env.sh first." >&2
  exit 1
fi

# set_var <NAME> <value>: replaces NAME=… or appends it. The value travels
# through the environment, not argv, so it never shows up in `ps`.
set_var() {
  local tmp
  tmp="$(mktemp)"
  NAME="$1" VALUE="$2" awk '
    BEGIN { name = ENVIRON["NAME"]; value = ENVIRON["VALUE"] }
    index($0, name "=") == 1 { print name "=" value; done = 1; next }
    { print }
    END { if (!done) print name "=" value }
  ' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
}

current() { grep -E "^$1=." "$ENV_FILE" | head -1 | cut -d= -f2- || true; }

secret() { gcloud secrets versions access latest --secret="$1" --project="$PROJECT_ID"; }

set_var AUTH_GOOGLE_ID "$(secret oauth-client-id)"
set_var AUTH_GOOGLE_SECRET "$(secret oauth-client-secret)"
# Anything shorter than 32 characters is a placeholder, not a usable secret.
if [[ "$(current AUTH_SECRET | wc -c)" -le 32 ]]; then
  set_var AUTH_SECRET "$(openssl rand -base64 32)"
  log "AUTH_SECRET: generated a local value"
fi
set_var AUTH_URL "http://localhost:3000"
chmod 600 "$ENV_FILE"
log "filled AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, AUTH_SECRET and AUTH_URL in .env (mode 600)"
