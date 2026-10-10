import { EXTRACTION_VERSION } from "@soundcheck/core";
import {
  MIX_BUCKETS,
  type FeatureBeat,
  type FeatureVideo,
  type TrafficMix,
} from "@soundcheck/core/features";
import { readChannelRows } from "@soundcheck/core/jobs";
import {
  beatVideoRowSchema,
  featureBeatSchema,
  trainingAudienceSchema,
  videoFormatSchema,
  type TrainingAudience,
} from "@soundcheck/core/schemas";

/** One point of a measured curve: the label and survival before it. */
export interface CurvePoint {
  bin: number;
  sMono: number;
  hazard: number;
  asOf: string;
}

/** Everything `features` reads for a channel, validated. */
export interface FeatureInputs {
  videos: Array<{ videoId: string; durationS: number; eligible: boolean }>;
  /** The current extraction (`EXTRACTION_VERSION`) of each video that has one. */
  extractions: Map<string, FeatureVideo>;
  /** Complete curves, 100 points in bin order, by video and audience. */
  curves: Map<string, Map<TrainingAudience, CurvePoint[]>>;
  /** Views by video and subscribed status. */
  views: Map<string, { subscribed: number; unsubscribed: number }>;
  /** Newcomer traffic mix by video; absent when YouTube reported none. */
  newcomerMix: Map<string, TrafficMix>;
}

/** DATE values arrive from the client as `{ value }` objects. */
const plain = (value: unknown): unknown =>
  value !== null && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;

/** JSON columns arrive from the client as strings. */
const parsed = (value: unknown): unknown => (typeof value === "string" ? JSON.parse(value) : value);

const isTrainingAudience = (value: unknown): value is TrainingAudience =>
  trainingAudienceSchema.safeParse(value).success;

/** Reads the channel's videos, curves, views, mixes and current beats from BigQuery. */
export async function readFeatureInputs(channelId: string): Promise<FeatureInputs> {
  const read = (table: string, columns: string[]) => readChannelRows(table, columns, channelId);
  const [videoRows, coverageRows, curveRows, statsRows, mixRows, beatVideoRows, beatRows] =
    await Promise.all([
      read("videos", ["video_id", "duration_s", "eligible"]),
      read("retention_coverage", ["video_id", "audience", "status"]),
      read("retention_curves", ["video_id", "audience", "bin", "s_mono", "hazard", "as_of"]),
      read("video_stats", ["video_id", "subscribed_status", "views"]),
      read("video_traffic_mix", ["video_id", "subscribed_status", "bucket", "share"]),
      read("beat_videos", [
        "video_id",
        "extraction_version",
        "format",
        "target_level",
        "payoff_time_s",
      ]),
      read("beats", [
        "video_id",
        "extraction_version",
        "beat_index",
        "start_s",
        "end_s",
        "beat_type",
        "details",
      ]),
    ]);

  const videos = videoRows
    .map((row) => ({
      videoId: String(row.video_id),
      durationS: Number(row.duration_s),
      eligible: row.eligible === true,
    }))
    .sort((a, b) => a.videoId.localeCompare(b.videoId));

  // Complete curves only: a partial curve is never filled in.
  const complete = new Set(
    coverageRows
      .filter((row) => row.status === "complete")
      .map((row) => `${String(row.video_id)}/${String(row.audience)}`),
  );
  const curves = new Map<string, Map<TrainingAudience, CurvePoint[]>>();
  for (const row of curveRows) {
    const videoId = String(row.video_id);
    const audience = row.audience;
    if (!isTrainingAudience(audience) || !complete.has(`${videoId}/${audience}`)) continue;
    const byAudience = curves.get(videoId) ?? new Map<TrainingAudience, CurvePoint[]>();
    const points = byAudience.get(audience) ?? [];
    points.push({
      bin: Number(row.bin),
      sMono: Number(row.s_mono),
      hazard: Number(row.hazard),
      asOf: String(plain(row.as_of)),
    });
    byAudience.set(audience, points);
    curves.set(videoId, byAudience);
  }
  for (const byAudience of curves.values()) {
    for (const [audience, points] of byAudience) {
      points.sort((a, b) => a.bin - b.bin);
      if (points.length !== 100 || points.some((point, index) => point.bin !== index + 1)) {
        byAudience.delete(audience);
      }
    }
  }

  const views = new Map<string, { subscribed: number; unsubscribed: number }>();
  for (const row of statsRows) {
    const videoId = String(row.video_id);
    const entry = views.get(videoId) ?? { subscribed: 0, unsubscribed: 0 };
    if (row.subscribed_status === "SUBSCRIBED") entry.subscribed += Number(row.views ?? 0);
    if (row.subscribed_status === "UNSUBSCRIBED") entry.unsubscribed += Number(row.views ?? 0);
    views.set(videoId, entry);
  }

  // Shares within newcomers, summed over the raw traffic types in each bucket.
  const newcomerMix = new Map<string, TrafficMix>();
  for (const row of mixRows) {
    if (row.subscribed_status !== "UNSUBSCRIBED") continue;
    const videoId = String(row.video_id);
    const mix = newcomerMix.get(videoId) ?? { search: 0, suggested: 0, browse: 0 };
    const bucket = MIX_BUCKETS.find((name) => name === row.bucket);
    newcomerMix.set(
      videoId,
      bucket ? { ...mix, [bucket]: mix[bucket] + Number(row.share ?? 0) } : mix,
    );
  }

  const beatsByVideo = new Map<string, Array<{ index: number; beat: FeatureBeat }>>();
  for (const row of beatRows) {
    if (row.extraction_version !== EXTRACTION_VERSION) continue;
    const videoId = String(row.video_id);
    const beat = featureBeatSchema.parse({
      ...(parsed(row.details) as Record<string, unknown>),
      start_s: Number(row.start_s),
      end_s: Number(row.end_s),
      beat_type: row.beat_type,
    });
    beatsByVideo.set(videoId, [
      ...(beatsByVideo.get(videoId) ?? []),
      { index: Number(row.beat_index), beat },
    ]);
  }
  const extractions = new Map<string, FeatureVideo>();
  for (const row of beatVideoRows) {
    if (row.extraction_version !== EXTRACTION_VERSION) continue;
    const videoId = String(row.video_id);
    const beats = beatsByVideo.get(videoId);
    if (!beats) continue;
    extractions.set(videoId, {
      format: videoFormatSchema.parse(row.format),
      target_level: beatVideoRowSchema.shape.target_level.parse(Number(row.target_level)),
      payoff_time_s:
        row.payoff_time_s === null || row.payoff_time_s === undefined
          ? null
          : Number(row.payoff_time_s),
      beats: beats.sort((a, b) => a.index - b.index).map(({ beat }) => beat),
    });
  }

  return { videos, extractions, curves, views, newcomerMix };
}
