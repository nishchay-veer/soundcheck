CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.retention_coverage` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  audience STRING NOT NULL,
  status STRING NOT NULL,
  points INT64,
  rewatch_bumps INT64,
  rewatch_mass FLOAT64,
  as_of DATE NOT NULL,
  details JSON
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'Whether a measured curve exists for each video and audience, and why not when it does not.');
