import { replaceChannelRows } from "@soundcheck/core/jobs";
import type { DeviceMixRow, TrafficMixRow } from "@soundcheck/core/schemas";
import {
  deviceQuery,
  parseDeviceMix,
  parseTrafficMix,
  trafficBatchSize,
  trafficQuery,
  videoBatches,
} from "@soundcheck/core/youtube";
import { catalogueVideos } from "./catalogue";
import { archiveKey, startIngest, type IngestOptions } from "./run";

export const MIX_STEP = "ingest-mix";

/**
 * `soundcheck ingest mix`: where each eligible video's views came from
 * (traffic source) and what they were watched on (device), split by
 * subscribed status, replacing the channel's `video_traffic_mix` and
 * `video_device_mix` rows. Traffic batches are sized so videos × days stays
 * within the report's 50,000 limit.
 */
export async function ingestMix(
  options: IngestOptions,
): Promise<{ traffic: TrafficMixRow[]; devices: DeviceMixRow[] } | undefined> {
  const run = await startIngest(MIX_STEP, options);
  if (!run) return undefined;
  const channelId = run.channel.id;

  const videos = await catalogueVideos(run);
  const trafficBatches = videoBatches(videos, run.asOf, trafficBatchSize);
  const deviceBatches = videoBatches(videos, run.asOf);
  const total = trafficBatches.length + deviceBatches.length;
  const context = (videoIds: readonly string[]) => ({ channelId, asOf: run.asOf, videoIds });

  const traffic: TrafficMixRow[] = [];
  for (const [index, batch] of trafficBatches.entries()) {
    const key = archiveKey("batch", index);
    const body = await run.report("analytics-traffic", key, trafficQuery(batch));
    traffic.push(...parseTrafficMix(body, context(batch.videoIds)));
    run.progress.update(index + 1, total);
  }
  const devices: DeviceMixRow[] = [];
  for (const [index, batch] of deviceBatches.entries()) {
    const key = archiveKey("batch", index);
    const body = await run.report("analytics-device", key, deviceQuery(batch));
    devices.push(...parseDeviceMix(body, context(batch.videoIds)));
    run.progress.update(trafficBatches.length + index + 1, total);
  }

  const load = { channelId, runId: run.runId, log: run.log };
  await replaceChannelRows({ ...load, table: "video_traffic_mix", rows: traffic });
  await replaceChannelRows({ ...load, table: "video_device_mix", rows: devices });
  await run.finish(
    { video_traffic_mix: traffic.length, video_device_mix: devices.length },
    { videos: videos.length },
  );
  return { traffic, devices };
}
