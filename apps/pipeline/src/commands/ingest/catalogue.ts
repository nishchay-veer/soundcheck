import { pickServerEnv } from "@soundcheck/core";
import { replaceChannelRows } from "@soundcheck/core/jobs";
import { videoRowSchema, type VideoRow } from "@soundcheck/core/schemas";
import {
  DATA_API_PAGE_SIZE,
  VIDEOS_PER_QUERY,
  contentTypeQuery,
  parseContentTypes,
  parseUploadsPage,
  parseVideos,
  uploadsPageRequest,
  videoBatches,
  videosRequest,
  type VideoMetadata,
} from "@soundcheck/core/youtube";
import { exclusionReason } from "./eligibility";
import { archiveKey, startIngest, type IngestOptions } from "./run";

export const CATALOGUE_STEP = "ingest-catalogue";

export function toVideoRow(
  channelId: string,
  video: VideoMetadata,
  contentType: string | null,
  { now, minViews }: { now: Date; minViews: number },
): VideoRow {
  const reason = exclusionReason({ ...video, contentType }, { now, minViews });
  return videoRowSchema.parse({
    channel_id: channelId,
    video_id: video.id,
    title: video.title,
    description: video.description,
    published_at: video.publishedAt,
    duration_s: video.durationS,
    content_type: contentType,
    is_live: video.isLive,
    category_id: video.categoryId,
    tags: video.tags,
    thumbnail_url: video.thumbnailUrl,
    default_language: video.language,
    eligible: reason === null,
    exclusion_reason: reason,
    ingested_at: now.toISOString(),
  });
}

/**
 * `soundcheck ingest catalogue`: every upload with its metadata, Analytics
 * content type and training eligibility, replacing the channel's `videos` rows.
 * Returns the rows, or undefined when the step was already done.
 */
export async function ingestCatalogue(options: IngestOptions): Promise<VideoRow[] | undefined> {
  const run = await startIngest(CATALOGUE_STEP, options);
  if (!run) return undefined;
  const { channel } = run;

  // 1. The uploads playlist, 50 IDs per page.
  const uploads: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page === 0 || pageToken; page += 1) {
    const body = await run.uploadsPage(
      archiveKey("page", page),
      uploadsPageRequest(channel.uploadsPlaylistId, pageToken),
    );
    const parsed = parseUploadsPage(body);
    uploads.push(...parsed.videoIds);
    pageToken = parsed.nextPageToken ?? undefined;
  }
  const videoIds = [...new Set(uploads)];

  // 2. Metadata, 50 videos per call; 3. content types, 25 videos per query.
  const idBatches: string[][] = [];
  for (let start = 0; start < videoIds.length; start += DATA_API_PAGE_SIZE) {
    idBatches.push(videoIds.slice(start, start + DATA_API_PAGE_SIZE));
  }
  // Progress counts API calls. Until the content-type batches are known, the
  // total assumes one per 25 videos, an upper bound.
  let total = idBatches.length + Math.ceil(videoIds.length / VIDEOS_PER_QUERY);

  const videos: VideoMetadata[] = [];
  for (const [index, ids] of idBatches.entries()) {
    videos.push(...parseVideos(await run.videos(archiveKey("batch", index), videosRequest(ids))));
    run.progress.update(index + 1, total);
  }

  const contentTypes = new Map<string, string>();
  const batches = videoBatches(videos, run.asOf);
  total = idBatches.length + batches.length;
  for (const [index, batch] of batches.entries()) {
    const key = archiveKey("batch", index);
    const body = await run.report("analytics-content-type", key, contentTypeQuery(batch));
    for (const [videoId, type] of parseContentTypes(body)) contentTypes.set(videoId, type);
    run.progress.update(idBatches.length + index + 1, total);
  }
  run.progress.update(total, total);

  // 4. Eligibility, then one load that replaces the channel's rows.
  const { MIN_VIEWS: minViews } = pickServerEnv(["MIN_VIEWS"]);
  const rows = videos.map((video) =>
    toVideoRow(channel.id, video, contentTypes.get(video.id) ?? null, {
      now: run.startedAt,
      minViews,
    }),
  );
  await replaceChannelRows({
    table: "videos",
    channelId: channel.id,
    rows,
    runId: run.runId,
    log: run.log,
  });

  const excluded: Record<string, number> = {};
  for (const row of rows) {
    if (row.exclusion_reason)
      excluded[row.exclusion_reason] = (excluded[row.exclusion_reason] ?? 0) + 1;
  }
  await run.finish(
    { videos: rows.length },
    {
      videos: rows.length,
      eligible: rows.filter((row) => row.eligible).length,
      excluded,
      missing: videoIds.length - videos.length,
      min_views: minViews,
    },
  );
  return rows;
}
