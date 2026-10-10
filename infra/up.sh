#!/usr/bin/env bash
# Builds the whole environment in order. The budget needs arguments, so run
# 07-budget.sh on its own. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")"
for script in 00-enable-apis.sh 01-service-accounts.sh 02-storage.sh 03-bigquery.sh \
  04-firestore.sh 05-kms.sh 06-artifact-registry.sh 08-secrets.sh 09-orchestration.sh; do
  echo "== $script" >&2
  bash "$script"
done
