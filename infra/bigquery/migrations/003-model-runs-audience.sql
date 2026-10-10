-- Phase 08: one model_runs row per audience's fit, so the row says which audience
-- its artifact is for. New tables already have it.
ALTER TABLE `{{project}}.{{dataset}}.model_runs` ADD COLUMN IF NOT EXISTS audience STRING;
