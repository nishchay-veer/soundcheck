CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.extraction_runs` (
  run_id STRING NOT NULL,
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  extraction_version STRING NOT NULL,
  gemini_model STRING,
  status STRING NOT NULL,
  started_at TIMESTAMP NOT NULL,
  finished_at TIMESTAMP,
  details JSON
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'One row per Gemini extraction attempt.');
