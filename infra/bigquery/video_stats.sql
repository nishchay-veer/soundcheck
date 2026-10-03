CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.video_stats` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  subscribed_status STRING NOT NULL,
  views INT64,
  estimated_minutes_watched FLOAT64,
  average_view_duration_s FLOAT64,
  average_view_percentage FLOAT64,
  as_of DATE NOT NULL
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'Per-video totals from YouTube Analytics, split by subscribed status. Labels and weights only, never features.');
