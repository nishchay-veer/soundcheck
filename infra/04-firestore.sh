#!/usr/bin/env bash
# Creates the default Firestore Native database and deploys firestore.rules
# (deny all client access) through the Firebase Rules API. Safe to re-run: the
# rules are only re-released when the file changed.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

if gcloud firestore databases describe --database="$FIRESTORE_DATABASE" \
  --project="$PROJECT_ID" >/dev/null 2>&1; then
  log "exists: Firestore database $FIRESTORE_DATABASE"
else
  gcloud firestore databases create --database="$FIRESTORE_DATABASE" \
    --location="$REGION" --type=firestore-native --project="$PROJECT_ID"
  log "created: Firestore database $FIRESTORE_DATABASE ($REGION)"
fi

RULES_FILE="$INFRA_DIR/firestore.rules"
RELEASE="projects/${PROJECT_ID}/releases/cloud.firestore"

# rules_api <method> <path> [curl args...]
rules_api() {
  local method="$1" path="$2"
  shift 2
  curl -fsS -X "$method" "https://firebaserules.googleapis.com/v1/${path}" \
    -H "Authorization: Bearer $(gcloud auth print-access-token)" \
    -H "x-goog-user-project: ${PROJECT_ID}" \
    -H "Content-Type: application/json" "$@"
}

current_ruleset=""
if release_json="$(rules_api GET "$RELEASE" 2>/dev/null)"; then
  current_ruleset="$(jq -r '.rulesetName' <<<"$release_json")"
fi

if [[ -n "$current_ruleset" ]] &&
  rules_api GET "$current_ruleset" | jq -e --rawfile src "$RULES_FILE" \
    '.source.files[0].content == $src' >/dev/null; then
  log "firestore.rules already released"
  exit 0
fi

ruleset="$(jq -n --rawfile src "$RULES_FILE" \
  '{source: {files: [{name: "firestore.rules", content: $src}]}}' |
  rules_api POST "projects/${PROJECT_ID}/rulesets" --data @- | jq -r '.name')"

if [[ -n "$current_ruleset" ]]; then
  jq -n --arg name "$RELEASE" --arg ruleset "$ruleset" \
    '{release: {name: $name, rulesetName: $ruleset}}' |
    rules_api PATCH "$RELEASE" --data @- >/dev/null
else
  jq -n --arg name "$RELEASE" --arg ruleset "$ruleset" \
    '{name: $name, rulesetName: $ruleset}' |
    rules_api POST "projects/${PROJECT_ID}/releases" --data @- >/dev/null
fi
log "released firestore.rules as $ruleset"
