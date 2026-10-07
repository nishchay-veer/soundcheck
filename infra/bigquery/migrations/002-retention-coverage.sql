-- Phase 04: point counts and rewatch measures per video and audience. New tables already have them.
ALTER TABLE `{{project}}.{{dataset}}.retention_coverage` ADD COLUMN IF NOT EXISTS points INT64;
ALTER TABLE `{{project}}.{{dataset}}.retention_coverage` ADD COLUMN IF NOT EXISTS rewatch_bumps INT64;
ALTER TABLE `{{project}}.{{dataset}}.retention_coverage` ADD COLUMN IF NOT EXISTS rewatch_mass FLOAT64;
