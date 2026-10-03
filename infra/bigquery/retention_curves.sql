CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.retention_curves` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  audience STRING NOT NULL,
  bin INT64 NOT NULL,
  elapsed_ratio FLOAT64 NOT NULL,
  audience_watch_ratio FLOAT64,
  relative_retention FLOAT64,
  started_watching FLOAT64,
  stopped_watching FLOAT64,
  total_segment_impressions FLOAT64,
  s_mono FLOAT64,
  hazard FLOAT64,
  as_of DATE NOT NULL
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'Measured retention curves on the 100-bin timeline, one row per video, audience and bin.');
