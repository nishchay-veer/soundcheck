CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.model_runs` (
  run_id STRING NOT NULL,
  channel_id STRING NOT NULL,
  audience STRING,
  model_version STRING NOT NULL,
  feature_version STRING NOT NULL,
  status STRING NOT NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  artifact_uri STRING,
  details JSON
)
CLUSTER BY channel_id
OPTIONS (description = 'One row per fitted audience model; channel_id is pooled for the model fitted across channels.');
