-- BigQuery partitions only by time or integer range, so the table is clustered
-- by channel and video instead of partitioned by channel.
CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.training_bins` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  audience STRING NOT NULL,
  bin INT64 NOT NULL,
  hazard FLOAT64 NOT NULL,
  n_at_risk FLOAT64 NOT NULL,
  video_views INT64 NOT NULL,
  feature_version STRING NOT NULL,
  extraction_version STRING NOT NULL,
  as_of DATE NOT NULL,
  x ARRAY<FLOAT64>
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'One row per video, audience and bin: the measured hazard (label), viewers at risk and views (weights), and the feature vector x in feature_specs order.');
