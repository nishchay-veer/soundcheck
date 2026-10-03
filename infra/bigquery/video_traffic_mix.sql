CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.video_traffic_mix` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  subscribed_status STRING NOT NULL,
  raw_type STRING NOT NULL,
  bucket STRING NOT NULL,
  views INT64,
  share FLOAT64,
  as_of DATE NOT NULL
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'Per-video traffic mix: the raw YouTube traffic type, the bucket it maps to, and its share of views.');
