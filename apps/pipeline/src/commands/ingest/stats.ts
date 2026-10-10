import { replaceChannelRows } from "@soundcheck/core/jobs";
import type { VideoStatsRow } from "@soundcheck/core/schemas";
import { parseStats, statsQuery, videoBatches } from "@soundcheck/core/youtube";
import { catalogueVideos } from "./catalogue";
import { archiveKey, coveredVideos, startIngest, type IngestOptions } from "./run";

export const STATS_STEP = "ingest-stats";

/**
 * `soundcheck ingest stats`: lifetime views, watch time and average view
 * duration per eligible video, split into subscribers and non-subscribers,
 * replacing the channel's `video_stats` rows (or, with `publishedSince`, the
 * recent videos' rows). 25 videos per Analytics query.
 */
export async function ingestStats(options: IngestOptions): Promise<VideoStatsRow[] | undefined> {
  const run = await startIngest(STATS_STEP, options);
  if (!run) return undefined;
  const channelId = run.channel.id;

  const videos = coveredVideos(await catalogueVideos(run), options.publishedSince);
  const batches = videoBatches(videos, run.asOf);
  const rows: VideoStatsRow[] = [];
  for (const [index, batch] of batches.entries()) {
    const body = await run.report("analytics-stats", archiveKey("batch", index), statsQuery(batch));
    rows.push(...parseStats(body, { channelId, asOf: run.asOf, videoIds: batch.videoIds }));
    run.progress.update(index + 1, batches.length);
  }

  await replaceChannelRows({
    table: "video_stats",
    channelId,
    rows,
    runId: run.runId,
    log: run.log,
    ...(options.publishedSince ? { videoIds: videos.map((video) => video.id) } : {}),
  });
  await run.finish(
    { video_stats: rows.length },
    { videos: videos.length, empty_slices: rows.filter((row) => row.views === 0).length },
  );
  return rows;
}
