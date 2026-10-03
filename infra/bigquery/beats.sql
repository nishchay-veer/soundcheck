CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.beats` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  extraction_version STRING NOT NULL,
  beat_index INT64 NOT NULL,
  start_s FLOAT64 NOT NULL,
  end_s FLOAT64 NOT NULL,
  beat_type STRING NOT NULL,
  extracted_at TIMESTAMP NOT NULL,
  details JSON
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'Typed beats extracted by Gemini, one row per beat.');
