#!/usr/bin/env bash
# Creates the soundcheck dataset in US, applies every DDL file in bigquery/,
# then every migration in bigquery/migrations/ in name order, and grants
# dataEditor on the dataset. Safe to re-run: tables are CREATE TABLE IF NOT
# EXISTS and migrations are written to be idempotent (ADD COLUMN IF NOT EXISTS).
# shellcheck source=lib.sh
source "$(dirname "$0")/lib.sh"

bq_() { bq --headless --project_id="$PROJECT_ID" --location="$BQ_LOCATION" "$@"; }

if bq_ show --format=none "${PROJECT_ID}:${BQ_DATASET}" >/dev/null 2>&1; then
  log "exists: dataset ${BQ_DATASET}"
else
  bq_ mk --dataset --description="Soundcheck training warehouse" "${PROJECT_ID}:${BQ_DATASET}"
  log "created: dataset ${BQ_DATASET} (${BQ_LOCATION})"
fi

for ddl in "$INFRA_DIR"/bigquery/*.sql "$INFRA_DIR"/bigquery/migrations/*.sql; do
  # Full-line comments are dropped: bq reads a query starting with "--" as a flag.
  sql="$(sed -e '/^[[:space:]]*--/d' -e "s/{{project}}/${PROJECT_ID}/g" -e "s/{{dataset}}/${BQ_DATASET}/g" "$ddl")"
  bq_ query --nouse_legacy_sql --quiet "$sql" >/dev/null
  log "applied: ${ddl#"$INFRA_DIR"/bigquery/}"
done

# sa-pipeline writes training data; sa-web deletes a channel's rows on request.
for sa in sa-pipeline sa-web; do
  retry bq_ query --nouse_legacy_sql --quiet \
    "GRANT \`roles/bigquery.dataEditor\` ON SCHEMA \`${PROJECT_ID}.${BQ_DATASET}\` TO \"$(sa_member "$sa")\"" >/dev/null
  log "dataset ${BQ_DATASET}: roles/bigquery.dataEditor -> $(sa_member "$sa")"
done
