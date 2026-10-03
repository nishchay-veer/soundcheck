CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.eval_runs` (
  run_id STRING NOT NULL,
  model_run_id STRING NOT NULL,
  channel_id STRING NOT NULL,
  model_version STRING NOT NULL,
  feature_version STRING NOT NULL,
  status STRING NOT NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  details JSON
)
CLUSTER BY channel_id
OPTIONS (description = 'One row per held-out evaluation of a model run.');
