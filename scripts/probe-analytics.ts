/**
 * Phase 03 probe: runs each YouTube Analytics query shape the ingest steps
 * might use, for one or two videos of a connected channel, and prints the
 * column headers and first rows, or the API's error. Video IDs and titles are
 * replaced with placeholders so the output can be pasted into the notes.
 *
 *   pnpm --filter @soundcheck/scripts probe-analytics --channel <CHANNEL_ID> [--video <VIDEO_ID>]
 */
import { parseArgs } from "node:util";
import { withRetry } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import { channelIdSchema } from "@soundcheck/core/schemas";
import {
  analyticsEndDate,
  credentialsForChannel,
  pacificDate,
  parsePlaylistItems,
  queryReport,
  reportRows,
  youtubeClient,
  type AnalyticsQuery,
} from "@soundcheck/core/youtube";

const { values } = parseArgs({
  options: { channel: { type: "string" }, video: { type: "string" } },
});
const channelId = values.channel ?? "";
if (!channelIdSchema.safeParse(channelId).success) {
  process.stderr.write("Usage: probe-analytics --channel <CHANNEL_ID> [--video <VIDEO_ID>]\n");
  process.exit(2);
}

const print = (line = "") => process.stdout.write(`${mask(line)}\n`);
const placeholders = new Map<string, string>();
const mask = (text: string) =>
  [...placeholders].reduce((out, [real, fake]) => out.replaceAll(real, fake), text);

const channel = await loadChannel(channelId);
const auth = await credentialsForChannel(channelId);
const youtube = youtubeClient(auth);

// The whole catalogue (the probe only needs a couple of videos, but they are
// ranked by views, so it reads every upload).
let dataUnits = 0;
const uploads: string[] = [];
let pageToken: string | undefined;
do {
  const page = await withRetry(
    () =>
      youtube.playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: channel.uploadsPlaylistId,
        maxResults: 50,
        pageToken,
      }),
    { operation: "youtube.playlistItems.list" },
  );
  dataUnits += 1;
  uploads.push(...parsePlaylistItems(page.data).map((item) => item.videoId));
  pageToken = page.data.nextPageToken ?? undefined;
} while (pageToken);

interface VideoInfo {
  id: string;
  title: string;
  publishedAt: string;
  duration: string;
  views: number;
  live: boolean;
}
const videos: VideoInfo[] = [];
for (let start = 0; start < uploads.length; start += 50) {
  const batch = await withRetry(
    () =>
      youtube.videos.list({
        part: ["snippet", "contentDetails", "statistics", "liveStreamingDetails"],
        id: uploads.slice(start, start + 50),
        maxResults: 50,
      }),
    { operation: "youtube.videos.list" },
  );
  dataUnits += 1;
  for (const item of batch.data.items ?? []) {
    videos.push({
      id: item.id ?? "",
      title: item.snippet?.title ?? "",
      publishedAt: item.snippet?.publishedAt ?? "",
      duration: item.contentDetails?.duration ?? "",
      views: Number(item.statistics?.viewCount ?? 0),
      live: Boolean(item.liveStreamingDetails),
    });
  }
}
videos.sort((a, b) => b.views - a.views);
videos.forEach((video, index) => {
  placeholders.set(video.id, `video_${index + 1}`);
  if (video.title) placeholders.set(video.title, `Video ${index + 1} title`);
});

const primary = videos.find((video) => video.id === values.video) ?? videos[0];
if (!primary) {
  print("The channel has no uploads to probe.");
  process.exit(1);
}
const secondary = videos.find((video) => video.id !== primary.id);
const pair = secondary ? `${primary.id},${secondary.id}` : primary.id;

const endDate = analyticsEndDate();
const channelStart = videos
  .map((video) => pacificDate(new Date(video.publishedAt)))
  .reduce((min, date) => (date < min ? date : min), endDate);
const videoStart = pacificDate(new Date(primary.publishedAt));

print(`# Analytics probe, ${new Date().toISOString().slice(0, 10)}`);
print(`Channel ${channelId}: ${videos.length} uploads; data through ${endDate} (Pacific).`);
for (const video of videos) {
  print(
    `  ${video.id}  published ${video.publishedAt}  ${video.duration}  ${video.views} public views${video.live ? "  (live details)" : ""}`,
  );
}
print(`Primary video: ${primary.id}; second video: ${secondary?.id ?? "none"}.`);

const STATS = "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage";
const MIX = "views,engagedViews,estimatedMinutesWatched";

const probes: Array<{ label: string; query: AnalyticsQuery }> = [
  {
    label: "content type: top videos by creatorContentType (spec)",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video,creatorContentType",
      metrics: "views",
      sort: "-views",
      maxResults: 200,
      startIndex: 1,
    },
  },
  {
    label: "content type: video,creatorContentType with a multi-video filter",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video,creatorContentType",
      metrics: "views",
      filters: `video==${videos
        .slice(0, 25)
        .map((video) => video.id)
        .join(",")}`,
    },
  },
  {
    label: "content type: top videos filtered to one creatorContentType",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video",
      metrics: "views",
      filters: "creatorContentType==VIDEO_ON_DEMAND",
      sort: "-views",
      maxResults: 200,
    },
  },
  {
    label: "content type: one video, creatorContentType as a dimension",
    query: {
      startDate: videoStart,
      endDate,
      dimensions: "creatorContentType",
      metrics: "views",
      filters: `video==${primary.id}`,
    },
  },
  {
    label: "stats: video,subscribedStatus with a multi-video filter (spec)",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video,subscribedStatus",
      metrics: STATS,
      filters: `video==${pair}`,
    },
  },
  {
    label: "stats: top videos for subscribed viewers",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video",
      metrics: STATS,
      filters: "subscribedStatus==SUBSCRIBED",
      sort: "-views",
      maxResults: 200,
    },
  },
  {
    label: "stats: top videos with subscribedStatus as a dimension",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video,subscribedStatus",
      metrics: STATS,
      sort: "-views",
      maxResults: 200,
    },
  },
  {
    label: "stats: one video, subscribedStatus as a dimension",
    query: {
      startDate: videoStart,
      endDate,
      dimensions: "subscribedStatus",
      metrics: STATS,
      filters: `video==${primary.id}`,
    },
  },
  {
    label: "stats: one video, subscribedStatus as a filter",
    query: {
      startDate: videoStart,
      endDate,
      metrics: STATS,
      filters: `video==${primary.id};subscribedStatus==SUBSCRIBED`,
    },
  },
  {
    label: "traffic: video,insightTrafficSourceType,subscribedStatus, multi-video filter (spec)",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video,insightTrafficSourceType,subscribedStatus",
      metrics: MIX,
      filters: `video==${pair}`,
    },
  },
  {
    label: "traffic: one video",
    query: {
      startDate: videoStart,
      endDate,
      dimensions: "insightTrafficSourceType,subscribedStatus",
      metrics: MIX,
      filters: `video==${primary.id}`,
    },
  },
  {
    label: "traffic: two videos without a video dimension (combined?)",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "insightTrafficSourceType,subscribedStatus",
      metrics: MIX,
      filters: `video==${pair}`,
    },
  },
  {
    label: "device: video,deviceType,subscribedStatus, multi-video filter (spec)",
    query: {
      startDate: channelStart,
      endDate,
      dimensions: "video,deviceType,subscribedStatus",
      metrics: MIX,
      filters: `video==${pair}`,
    },
  },
  {
    label: "device: one video",
    query: {
      startDate: videoStart,
      endDate,
      dimensions: "deviceType,subscribedStatus",
      metrics: MIX,
      filters: `video==${primary.id}`,
    },
  },
];

/** The API's own message for a rejected query. */
function describeError(error: unknown): string {
  const { response, message } = error as {
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  const status = response?.status ? `HTTP ${response.status}: ` : "";
  return `${status}${response?.data?.error?.message ?? message ?? String(error)}`;
}

let queries = 0;
async function run(query: AnalyticsQuery): Promise<boolean> {
  const shown = Object.entries(query)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(" ");
  print(`  request: ${shown}`);
  try {
    queries += 1;
    const body = await queryReport(auth, query);
    const { columnHeaders } = body as {
      columnHeaders: Array<{ name: string; columnType: string; dataType: string }>;
    };
    const rows = reportRows(body);
    print(
      `  OK. columns: ${columnHeaders.map((h) => `${h.name} (${h.columnType} ${h.dataType})`).join(", ")}`,
    );
    print(`  ${rows.length} rows${rows.length > 8 ? ", first 8:" : ":"}`);
    for (const row of rows.slice(0, 8)) print(`    ${JSON.stringify(Object.values(row))}`);
    return true;
  } catch (error) {
    print(`  ERROR. ${describeError(error)}`);
    return false;
  }
}

for (const { label, query } of probes) {
  print();
  print(`## ${label}`);
  if (await run(query)) continue;
  // Tell an unsupported query shape apart from an unsupported metric.
  if (query.metrics.includes("engagedViews")) {
    print("  Retrying without engagedViews:");
    const metrics = query.metrics.replace("engagedViews,", "");
    if (await run({ ...query, metrics })) continue;
    if (metrics.includes("averageViewPercentage")) {
      print("  Retrying without averageViewPercentage too:");
      await run({ ...query, metrics: metrics.replace(",averageViewPercentage", "") });
    }
  }
}

print();
print(`${queries} Analytics queries; ${dataUnits} Data API units.`);
