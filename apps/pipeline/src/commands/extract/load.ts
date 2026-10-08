import { randomUUID } from "node:crypto";
import { childLogger, logger as rootLogger, type Logger } from "@soundcheck/core";
import {
  beatRows,
  beatVideoRow,
  extractionRequest,
  extractionSettings,
  readCachedExtraction,
  readRunRecords,
  type CachedExtraction,
  type ExtractionSettings,
} from "@soundcheck/core/gemini";
import { readChannelRows, replaceChannelRows } from "@soundcheck/core/jobs";

/**
 * `soundcheck extract load`: rebuilds the channel's `beats`, `beat_videos` and
 * `extraction_runs` rows from the raw bucket. Beats come from the cached
 * extraction of every catalogue video under the current settings (model,
 * video mode, prompt, version); runs from every run record. Sharded
 * `extract beats` tasks skip loading, and this runs once after them.
 */
export async function loadBeats(
  channelId: string,
  {
    settings = extractionSettings(),
    log = rootLogger,
  }: { settings?: ExtractionSettings; log?: Logger } = {},
): Promise<{ videos: number; beats: number; runs: number }> {
  const runId = randomUUID().replaceAll("-", "");
  const loadLog = childLogger({ channel_id: channelId, stage: "extract-load", run_id: runId }, log);

  const extractions: CachedExtraction[] = [];
  for (const row of await readChannelRows("videos", ["video_id"], channelId)) {
    const videoId = String(row.video_id);
    const cached = await readCachedExtraction(
      channelId,
      videoId,
      extractionRequest(videoId, settings).key,
    );
    if (cached) extractions.push(cached);
  }
  const runs = await readRunRecords(channelId);

  const load = { channelId, runId, log: loadLog };
  const beats = extractions.flatMap(beatRows);
  await replaceChannelRows({ ...load, table: "beats", rows: beats });
  await replaceChannelRows({ ...load, table: "beat_videos", rows: extractions.map(beatVideoRow) });
  await replaceChannelRows({ ...load, table: "extraction_runs", rows: runs });

  const counts = { videos: extractions.length, beats: beats.length, runs: runs.length };
  loadLog.info(counts, "beats loaded");
  return counts;
}
