CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.videos` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  title STRING,
  description STRING,
  published_at TIMESTAMP,
  duration_s INT64,
  content_type STRING,
  is_live BOOL,
  category_id STRING,
  tags ARRAY<STRING>,
  thumbnail_url STRING,
  default_language STRING,
  eligible BOOL,
  exclusion_reason STRING,
  ingested_at TIMESTAMP NOT NULL
)
CLUSTER BY channel_id
OPTIONS (description = 'Video metadata from the YouTube Data API, with training eligibility.');
