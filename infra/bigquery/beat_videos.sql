CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.beat_videos` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  extraction_version STRING NOT NULL,
  cache_key STRING NOT NULL,
  gemini_model STRING NOT NULL,
  video_mode STRING NOT NULL,
  format STRING NOT NULL,
  video_summary STRING,
  title_promise STRING,
  target_level INT64,
  payoff_time_s FLOAT64,
  beat_count INT64 NOT NULL,
  coverage FLOAT64 NOT NULL,
  duration_s FLOAT64 NOT NULL,
  extracted_at TIMESTAMP NOT NULL
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'One row per video and beat extraction: the video-level answers (format, summary, title promise, target level, payoff time).');
