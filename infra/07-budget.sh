#!/usr/bin/env bash
# Creates a monthly budget for this project with email alerts at 50%, 90% and
# 100% of the amount. Alerts go to the billing account's admins and users.
# Spend is measured before credits, so alerts still fire while free-trial or
# promotional credits cover the bill. A budget only alerts; it never caps spend.
#
#   infra/07-budget.sh <BILLING_ACCOUNT_ID> <AMOUNT>
#   infra/07-budget.sh 012345-6789AB-CDEF01 50          # billing account currency
#   infra/07-budget.sh 012345-6789AB-CDEF01 4000INR     # explicit currency
#
# Safe to re-run: an existing budget with the same name is left alone.
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

BILLING_ACCOUNT="${1:?usage: 07-budget.sh <BILLING_ACCOUNT_ID> <AMOUNT>}"
AMOUNT="${2:?usage: 07-budget.sh <BILLING_ACCOUNT_ID> <AMOUNT>}"
NAME="soundcheck-${PROJECT_ID}"

existing="$(gcloud billing budgets list --billing-account="$BILLING_ACCOUNT" \
  --filter="displayName=${NAME}" --format='value(name)' 2>/dev/null)"
if [[ -n "$existing" ]]; then
  log "exists: budget $NAME ($existing); change it in the console or delete it to recreate"
  exit 0
fi

gcloud billing budgets create --billing-account="$BILLING_ACCOUNT" \
  --display-name="$NAME" --budget-amount="$AMOUNT" \
  --filter-projects="projects/${PROJECT_ID}" \
  --credit-types-treatment=exclude-all-credits \
  --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0
log "created: budget $NAME for $AMOUNT (before credits) with alerts at 50%, 90%, 100%"
