import type { ExclusionReason } from "@soundcheck/core/schemas";

/**
 * Content types used for training: videos on demand and live streams. Shorts
 * are left out: they loop (retention starts above 100%) and are watched in a
 * swipe feed, and the model has no input that tells them apart.
 */
export const ELIGIBLE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "VIDEO_ON_DEMAND",
  "LIVE_STREAM",
]);
export const MIN_DURATION_S = 60;
export const MAX_DURATION_S = 3 * 60 * 60;
export const MIN_AGE_DAYS = 7;

export interface EligibilityInput {
  /** Normalized Analytics content type (`VIDEO_ON_DEMAND`, `SHORTS`, …); null when unknown. */
  contentType: string | null;
  durationS: number;
  publishedAt: string;
  /** Lifetime public views. */
  viewCount: number;
}

/**
 * The first rule a video fails, or null if it is eligible. Rules are checked
 * so the reason is the most informative one: a video too new for Analytics
 * data is `too_recent`, not `content_type_unknown`, and a Story is
 * `unsupported_content_type`, not `too_short`.
 */
export function exclusionReason(
  video: EligibilityInput,
  { now, minViews }: { now: Date; minViews: number },
): ExclusionReason | null {
  if (now.getTime() - Date.parse(video.publishedAt) < MIN_AGE_DAYS * 86_400_000)
    return "too_recent";
  if (video.contentType !== null && !ELIGIBLE_CONTENT_TYPES.has(video.contentType)) {
    return "unsupported_content_type";
  }
  if (video.durationS < MIN_DURATION_S) return "too_short";
  if (video.durationS > MAX_DURATION_S) return "too_long";
  if (video.viewCount < minViews) return "too_few_views";
  if (video.contentType === null) return "content_type_unknown";
  return null;
}
