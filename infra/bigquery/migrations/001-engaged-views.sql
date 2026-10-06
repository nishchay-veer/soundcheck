-- Phase 03: engagedViews alongside views. On Aug 27, 2026 YouTube began counting
-- a view from the first frame (autoplay and hover included); engagedViews keeps
-- the earlier meaning, so later phases can choose. New tables already have it.
ALTER TABLE `{{project}}.{{dataset}}.video_stats` ADD COLUMN IF NOT EXISTS engaged_views INT64;
ALTER TABLE `{{project}}.{{dataset}}.video_traffic_mix` ADD COLUMN IF NOT EXISTS engaged_views INT64;
ALTER TABLE `{{project}}.{{dataset}}.video_device_mix` ADD COLUMN IF NOT EXISTS engaged_views INT64;
