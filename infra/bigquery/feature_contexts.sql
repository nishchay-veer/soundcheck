CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.feature_contexts` (
  channel_id STRING NOT NULL,
  feature_version STRING NOT NULL,
  extraction_version STRING NOT NULL,
  median_target_level FLOAT64 NOT NULL,
  mix_mean_search FLOAT64 NOT NULL,
  mix_mean_suggested FLOAT64 NOT NULL,
  mix_mean_browse FLOAT64 NOT NULL,
  video_ids ARRAY<STRING>,
  as_of DATE NOT NULL,
  created_at TIMESTAMP NOT NULL
)
CLUSTER BY channel_id
OPTIONS (description = 'The channel context the training_bins features were measured against (median target level, mean newcomer mix), written by soundcheck features; the fitter copies it into each model so predictions use the same.');
