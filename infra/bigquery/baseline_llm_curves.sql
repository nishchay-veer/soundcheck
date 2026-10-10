CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.baseline_llm_curves` (
  channel_id STRING NOT NULL,
  video_id STRING NOT NULL,
  prompt_version STRING NOT NULL,
  gemini_model STRING NOT NULL,
  video_mode STRING NOT NULL,
  cache_key STRING NOT NULL,
  points ARRAY<FLOAT64>,
  curve ARRAY<FLOAT64>,
  repaired BOOL NOT NULL,
  cost_usd FLOAT64,
  created_at TIMESTAMP NOT NULL
)
CLUSTER BY channel_id, video_id
OPTIONS (description = 'Generic-LLM baseline (B1): Gemini guesses a video retention curve for a typical YouTube audience, with no channel data. 20 points and their 100-bin interpolation.');
