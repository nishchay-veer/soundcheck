CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.channels` (
  channel_id STRING NOT NULL,
  user_id STRING NOT NULL,
  title STRING,
  subscriber_count INT64,
  video_count INT64,
  connected_at TIMESTAMP NOT NULL
)
OPTIONS (description = 'One row per connected YouTube channel.');
