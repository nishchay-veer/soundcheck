CREATE TABLE IF NOT EXISTS `{{project}}.{{dataset}}.quality_reports` (
  report_id STRING NOT NULL,
  channel_id STRING NOT NULL,
  stage STRING NOT NULL,
  run_id STRING,
  created_at TIMESTAMP NOT NULL,
  details JSON
)
CLUSTER BY channel_id
OPTIONS (description = 'Data-quality findings from any pipeline stage.');
