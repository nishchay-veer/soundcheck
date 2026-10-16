import { randomUUID } from "node:crypto";
import { childLogger, logger as rootLogger, type Logger } from "@soundcheck/core";
import { readChannelRows, replaceChannelRows } from "@soundcheck/core/jobs";
import { NEWEST_VIDEOS, videoRowSchema, type VideoRow } from "@soundcheck/core/schemas";

const COLUMNS: readonly (keyof VideoRow)[] = [
  "channel_id",
  "video_id",
  "title",
  "description",
  "published_at",
  "duration_s",
  "content_type",
  "is_live",
  "category_id",
  "tags",
  "thumbnail_url",
  "default_language",
  "eligible",
  "exclusion_reason",
  "ingested_at",
];

/** BigQuery returns TIMESTAMP values as `{ value }` objects. */
const plain = (value: unknown): unknown =>
  value !== null && typeof value === "object" && "value" in value
    ? (value as { value: unknown }).value
    : value;

/**
 * Keeps the channel's newest `newest` usable videos eligible (usable: eligible,
 * with a complete retention curve for a training audience, as `countVideos`
 * counts them) and marks every older eligible video `beyond_newest`. Runs
 * after the retention curves are read, so later stages only see the kept
 * videos. Writes nothing when the channel has no more than `newest`.
 */
export async function capVideos({
  channelId,
  newest = NEWEST_VIDEOS,
  log = rootLogger,
}: {
  channelId: string;
  newest?: number;
  log?: Logger;
}): Promise<{ kept: number; excluded: number }> {
  const runId = randomUUID().replaceAll("-", "");
  const capLog = childLogger({ channel_id: channelId, stage: "ingest-cap", run_id: runId }, log);
  const videos = (await readChannelRows("videos", COLUMNS, channelId)).map((row) =>
    videoRowSchema.parse(
      Object.fromEntries(Object.entries(row).map(([key, value]) => [key, plain(value)])),
    ),
  );
  const curved = new Set(
    (await readChannelRows("retention_coverage", ["video_id", "audience", "status"], channelId))
      .filter((row) => row.status === "complete" && row.audience !== "organic")
      .map((row) => String(row.video_id)),
  );
  // Newest first; a tie on the publish time goes by ID, so the cut is the same every time.
  const order = (a: VideoRow, b: VideoRow) =>
    b.published_at.localeCompare(a.published_at) || a.video_id.localeCompare(b.video_id);
  const usable = videos.filter((video) => video.eligible && curved.has(video.video_id)).sort(order);
  const last = usable[newest - 1];
  if (usable.length <= newest || !last) return { kept: usable.length, excluded: 0 };

  const kept = new Set(usable.slice(0, newest).map((video) => video.video_id));
  // Every eligible video no newer than the last one kept is left out, with or without a curve.
  const beyond = (video: VideoRow) =>
    video.eligible && !kept.has(video.video_id) && order(video, last) > 0;
  const rows = videos.map((video) =>
    beyond(video)
      ? { ...video, eligible: false, exclusion_reason: "beyond_newest" as const }
      : video,
  );
  const excluded = rows.filter((row) => row.exclusion_reason === "beyond_newest").length;
  await replaceChannelRows({ table: "videos", channelId, rows, runId, log: capLog });
  capLog.info({ kept: kept.size, excluded, newest }, "older videos left out");
  return { kept: kept.size, excluded };
}
