CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.feature_specs` (
  feature_version STRING NOT NULL,
  spec JSON NOT NULL,
  created_at TIMESTAMP NOT NULL
)
OPTIONS (description = 'The feature spec of each feature version: the ordered columns of training_bins.x, their kinds and clips.');
