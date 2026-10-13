import { EXTRACTION_VERSION, FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import { latestFittedModels, readChannelRows, readModelArtifact } from "@soundcheck/core/jobs";
import {
  TRANSCRIPT_EXCERPT_CHARS,
  evalDetailsSchema,
  videoBeatSchema,
  type EvalDetails,
  type MeasuredAudience,
  type ModelArtifact,
  type TrainingAudience,
  type VideoBeat,
} from "@soundcheck/core/schemas";
import { readFeatureInputs, type FeatureInputs } from "../features/inputs";

/** One eligible video as the screens show it. */
export interface CatalogueVideo {
  videoId: string;
  title: string;
  publishedAt: string;
  durationS: number;
  thumbnailUrl: string | null;
}

/** Lifetime totals of one video for one subscribed status. */
export interface StatusStats {
  views: number;
  minutesWatched: number;
  /** YouTube's average view percentage; null when it reported none. */
  avp: number | null;
}

/** The channel's latest held-out evaluation of the current model and feature versions. */
export interface HoldoutEvaluation {
  runId: string;
  /** The production run it vouches for. */
  modelRunId: string;
  details: EvalDetails;
}

/** Everything `publish` reads for a channel. */
export interface PublishInputs {
  features: FeatureInputs;
  /** Eligible videos, newest first: the ones published. */
  videos: CatalogueVideo[];
  stats: Map<string, Partial<Record<MeasuredAudience, StatusStats>>>;
  /** The current extraction's beats, with their summaries. */
  beats: Map<string, VideoBeat[]>;
  /** The latest fitted model per audience, and where each artifact is stored. */
  models: Map<TrainingAudience, ModelArtifact>;
  modelUris: Map<TrainingAudience, string>;
  evaluation: HoldoutEvaluation | null;
}

/**
 * The start of a beat's transcript for its hover card: whitespace collapsed,
 * cut at a word boundary with "…" when longer than the excerpt limit.
 */
export function transcriptExcerpt(transcript: unknown): string {
  const text = typeof transcript === "string" ? transcript.replace(/\s+/g, " ").trim() : "";
  if (text.length <= TRANSCRIPT_EXCERPT_CHARS) return text;
  const room = text.slice(0, TRANSCRIPT_EXCERPT_CHARS - 1);
  const space = room.lastIndexOf(" ");
  return `${(space > TRANSCRIPT_EXCERPT_CHARS / 2 ? room.slice(0, space) : room).trimEnd()}…`;
}

/** TIMESTAMP and DATE values arrive from the client as `{ value }` objects. */
const plain = (value: unknown): unknown =>
  value !== null && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;

/** JSON columns arrive from the client as strings. */
const parsed = (value: unknown): Record<string, unknown> =>
  (typeof value === "string" ? JSON.parse(value) : (value ?? {})) as Record<string, unknown>;

const STATUS: Record<string, MeasuredAudience> = {
  SUBSCRIBED: "subscribed",
  UNSUBSCRIBED: "unsubscribed",
};

/** Reads the channel's catalogue, stats, beats, models and evaluation, and the feature inputs. */
export async function readPublishInputs(channelId: string): Promise<PublishInputs> {
  const read = (table: string, columns: string[]) => readChannelRows(table, columns, channelId);
  const [features, videoRows, statsRows, beatRows, evalRows, fitted] = await Promise.all([
    readFeatureInputs(channelId),
    read("videos", [
      "video_id",
      "title",
      "published_at",
      "duration_s",
      "thumbnail_url",
      "eligible",
    ]),
    read("video_stats", [
      "video_id",
      "subscribed_status",
      "views",
      "estimated_minutes_watched",
      "average_view_percentage",
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
    read("eval_runs", [
      "run_id",
      "model_run_id",
      "status",
      "model_version",
      "feature_version",
      "finished_at",
      "details",
    ]),
    latestFittedModels(channelId, { modelVersion: MODEL_VERSION, featureVersion: FEATURE_VERSION }),
  ]);

  const videos = videoRows
    .filter((row) => row.eligible === true)
    .map((row) => ({
      videoId: String(row.video_id),
      title: String(row.title ?? ""),
      publishedAt: new Date(String(plain(row.published_at))).toISOString(),
      durationS: Number(row.duration_s),
      thumbnailUrl: typeof row.thumbnail_url === "string" ? row.thumbnail_url : null,
    }))
    .sort(
      (a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.videoId.localeCompare(b.videoId),
    );

  const stats = new Map<string, Partial<Record<MeasuredAudience, StatusStats>>>();
  for (const row of statsRows) {
    const audience = STATUS[String(row.subscribed_status)];
    if (!audience) continue;
    const videoId = String(row.video_id);
    stats.set(videoId, {
      ...stats.get(videoId),
      [audience]: {
        views: Number(row.views ?? 0),
        minutesWatched: Number(row.estimated_minutes_watched ?? 0),
        avp:
          row.average_view_percentage === null || row.average_view_percentage === undefined
            ? null
            : Number(row.average_view_percentage),
      },
    });
  }

  // Beats of the current extraction only, for videos whose extraction is complete.
  const indexed = new Map<string, Array<{ index: number; beat: VideoBeat }>>();
  for (const row of beatRows) {
    const videoId = String(row.video_id);
    if (row.extraction_version !== EXTRACTION_VERSION || !features.extractions.has(videoId))
      continue;
    const details = parsed(row.details);
    const beat = videoBeatSchema.parse({
      startS: Number(row.start_s),
      endS: Number(row.end_s),
      beatType: row.beat_type,
      visual: details.visual,
      talkingHeadShare: details.talking_head_share,
      summary: typeof details.summary === "string" ? details.summary : "",
      transcriptExcerpt: transcriptExcerpt(details.transcript),
    });
    indexed.set(videoId, [
      ...(indexed.get(videoId) ?? []),
      { index: Number(row.beat_index), beat },
    ]);
  }
  const beats = new Map(
    [...indexed].map(([videoId, list]) => [
      videoId,
      list.sort((a, b) => a.index - b.index).map(({ beat }) => beat),
    ]),
  );

  const models = new Map<TrainingAudience, ModelArtifact>();
  const modelUris = new Map<TrainingAudience, string>();
  for (const [audience, model] of fitted) {
    models.set(audience, await readModelArtifact(model.artifactUri));
    modelUris.set(audience, model.artifactUri);
  }

  const holdout = evalRows
    .filter(
      (row) =>
        row.status === "holdout" &&
        row.model_version === MODEL_VERSION &&
        row.feature_version === FEATURE_VERSION &&
        row.finished_at !== null,
    )
    .sort((a, b) => String(plain(b.finished_at)).localeCompare(String(plain(a.finished_at))))[0];
  const evaluation = holdout
    ? {
        runId: String(holdout.run_id),
        modelRunId: String(holdout.model_run_id),
        details: evalDetailsSchema.parse(parsed(holdout.details)),
      }
    : null;

  return { features, videos, stats, beats, models, modelUris, evaluation };
}
