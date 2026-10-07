/**
 * Records YouTube Data API and Analytics responses for a connected channel into
 * tests/fixtures/youtube, anonymized: every field and its type stay exactly as
 * Google sent them, while IDs, titles, descriptions, URLs, etags, dates and
 * counts are replaced with fixture values. Uses the pipeline's credentials path.
 *
 *   pnpm --filter @soundcheck/scripts record-fixtures <CHANNEL_ID>
 */
import { writeFileSync } from "node:fs";
import { withRetry } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import { channelIdSchema } from "@soundcheck/core/schemas";
import {
  analyticsEndDate,
  contentTypeQuery,
  credentialsForChannel,
  deviceQuery,
  pacificDate,
  retentionQuery,
  SEGMENT_METRICS,
  fetchVideos,
  parseVideos,
  queryReport,
  statsQuery,
  trafficBatchSize,
  trafficQuery,
  videoBatches,
  videosRequest,
  youtubeClient,
} from "@soundcheck/core/youtube";

const channelId = process.argv[2] ?? "";
if (!channelIdSchema.safeParse(channelId).success) {
  process.stderr.write("Usage: record-fixtures <CHANNEL_ID>\n");
  process.exit(2);
}

const FIXTURE_CHANNEL = "aBcDeFgHiJkLmNoPqRsTuV"; // the part after "UC" / "UU"
const realSuffix = channelId.slice(2);
const videoIds = new Map<string, string>();
const fixtureVideoId = (real: string) => {
  if (!videoIds.has(real)) videoIds.set(real, `fixtureVid${videoIds.size + 1}`);
  return videoIds.get(real) as string;
};

/** Replaces identifying values; keeps every key and every value's type. */
function anonymize(value: unknown, key = "", context: { video?: string } = {}): unknown {
  if (Array.isArray(value)) return value.map((item) => anonymize(item, key, context));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const resource = record.resourceId as { videoId?: string } | undefined;
    const ownId = record.kind === "youtube#video" ? (record.id as string) : undefined;
    const real = resource?.videoId ?? (record.videoId as string | undefined) ?? ownId;
    const next = real ? { video: fixtureVideoId(real) } : context;
    return Object.fromEntries(Object.entries(record).map(([k, v]) => [k, anonymize(v, k, next)]));
  }
  if (typeof value !== "string") return value;
  switch (key) {
    case "etag":
      return "fixture-etag";
    case "title":
      return context.video ? `Fixture video ${context.video.slice(-1)}` : "Fixture Channel";
    case "description":
      return context.video ? "" : "A channel that only exists in tests.";
    case "channelTitle":
    case "videoOwnerChannelTitle":
      return "Fixture Channel";
    case "customUrl":
      return "@fixturechannel";
    case "url":
      return context.video
        ? `https://i.ytimg.com/vi/${context.video}/default.jpg`
        : "https://yt3.ggpht.com/fixture";
    case "publishedAt":
    case "videoPublishedAt":
      return "2026-09-28T14:00:00Z";
    case "viewCount":
      return "1234567";
    case "likeCount":
      return "120";
    case "commentCount":
      return "8";
    case "tags":
      return "fixture tag";
    case "actualStartTime":
    case "actualEndTime":
    case "scheduledStartTime":
    case "scheduledEndTime":
      return "2026-09-28T14:00:00Z";
    case "activeLiveChatId":
      return "fixture-live-chat";
    case "subscriberCount":
      return "8450";
    case "videoCount":
      return "64";
    case "videoId":
      return fixtureVideoId(value);
    default:
      return rewriteIds(value);
  }
}

function replaceIds(text: string): string {
  let out = text.replaceAll(realSuffix, FIXTURE_CHANNEL);
  for (const [realId, fakeId] of videoIds) out = out.replaceAll(realId, fakeId);
  return out;
}

/**
 * Rewrites real IDs, including inside base64: a playlist item's `id` is the
 * base64 of "UU<channel>.<videoId>".
 */
function rewriteIds(value: string): string {
  if (/^[A-Za-z0-9+/]{16,}={0,2}$/.test(value)) {
    const decoded = Buffer.from(value, "base64").toString("utf8");
    const rewritten = replaceIds(decoded);
    if (rewritten !== decoded) return Buffer.from(rewritten, "utf8").toString("base64");
  }
  return replaceIds(value);
}

const channel = await loadChannel(channelId);
const auth = await credentialsForChannel(channelId);
const youtube = youtubeClient(auth);
const channels = await withRetry(
  () => youtube.channels.list({ part: ["snippet", "statistics", "contentDetails"], mine: true }),
  { operation: "youtube.channels.list" },
);
const uploads = await withRetry(
  () =>
    youtube.playlistItems.list({
      part: ["snippet", "contentDetails"],
      playlistId: channel.uploadsPlaylistId,
      maxResults: 5,
    }),
  { operation: "youtube.playlistItems.list" },
);

const dir = new URL("../tests/fixtures/youtube/", import.meta.url);
const write = (name: string, body: unknown) => {
  writeFileSync(new URL(name, dir), `${JSON.stringify(anonymize(body), null, 2)}\n`);
  process.stdout.write(`wrote tests/fixtures/youtube/${name}\n`);
};
// Map every video ID before rewriting anything, so IDs encoded in fields that
// come before the video's own fields are still caught.
for (const item of uploads.data.items ?? []) {
  if (item.contentDetails?.videoId) fixtureVideoId(item.contentDetails.videoId);
}
const uploadIds = (uploads.data.items ?? []).flatMap((item) => item.contentDetails?.videoId ?? []);
const videos =
  uploadIds.length > 0 ? await fetchVideos(auth, videosRequest(uploadIds)) : { items: [] };
// Analytics queries need the real publish dates, so they run before anonymizing.
const [batch] = videoBatches(parseVideos(videos), analyticsEndDate());
const contentTypes = batch ? await queryReport(auth, contentTypeQuery(batch)) : undefined;
const stats = batch ? await queryReport(auth, statsQuery(batch)) : undefined;
const [trafficBatch] = videoBatches(parseVideos(videos), analyticsEndDate(), trafficBatchSize);
const traffic = trafficBatch ? await queryReport(auth, trafficQuery(trafficBatch)) : undefined;
const devices = batch ? await queryReport(auth, deviceQuery(batch)) : undefined;

// Retention: every audience for the most-viewed long-form video, plus a Short.
const parsed = parseVideos(videos).sort((a, b) => b.viewCount - a.viewCount);
const curve = async (
  video: (typeof parsed)[number],
  audience: "all" | "subscribed" | "unsubscribed" | "organic",
  metrics?: string,
) =>
  queryReport(
    auth,
    retentionQuery(
      {
        videoId: video.id,
        audience,
        startDate: pacificDate(new Date(video.publishedAt)),
        endDate: analyticsEndDate(),
      },
      metrics,
    ),
    { maxAttempts: 2 },
  );
const regular = parsed.find((video) => video.durationS >= 120);
const short = parsed.find((video) => video.durationS <= 60);
const retention: Record<string, unknown> = {};
if (regular) {
  for (const audience of ["all", "subscribed", "unsubscribed", "organic"] as const) {
    retention[audience] = await curve(regular, audience);
  }
  retention.segments = await curve(regular, "all", SEGMENT_METRICS);
}
if (short) retention.short = await curve(short, "all");

write("playlistItems.list.uploads.json", uploads.data);
write("channels.list.mine.json", channels.data);
write("videos.list.uploads.json", videos);
if (contentTypes) write("reports.query.content-type.json", contentTypes);
if (stats) write("reports.query.stats.json", stats);
if (traffic) write("reports.query.traffic.json", traffic);
if (devices) write("reports.query.device.json", devices);
for (const [name, body] of Object.entries(retention)) {
  write(
    name === "segments"
      ? "reports.query.retention-segments.json"
      : `reports.query.retention.${name}.json`,
    body,
  );
}
