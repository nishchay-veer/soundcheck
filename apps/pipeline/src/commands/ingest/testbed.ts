/**
 * Shared setup for ingest command tests: in-memory Firestore, BigQuery and
 * Storage holding one connected channel, and a YouTube API that replays the
 * recorded fixtures. Test-only; never imported by the commands.
 */
import { readFileSync } from "node:fs";
import { createLogger, resetClients, resetEnvCache, setClientOverride } from "@soundcheck/core";
import type { ChannelDoc } from "@soundcheck/core/schemas";
import { FakeBigQuery, FakeFirestore, FakeGenAI, FakeStorage } from "@soundcheck/core/testing";
import type { AnalyticsQuery } from "@soundcheck/core/youtube";
import { vi, type Mock } from "vitest";
import type { YoutubeApi } from "./run";

export const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
export const NOW = new Date("2026-10-06T12:00:00Z");
/** `analyticsEndDate(NOW)`. */
export const AS_OF = "2026-10-03";
export const quiet = createLogger({ level: "silent" });

/** Column lists from `infra/bigquery/*.sql`, served by the BigQuery fake. */
export const COLUMNS: Record<string, string[]> = {
  videos: [
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
  ],
  video_stats: [
    "channel_id",
    "video_id",
    "subscribed_status",
    "views",
    "engaged_views",
    "estimated_minutes_watched",
    "average_view_duration_s",
    "average_view_percentage",
    "as_of",
  ],
  video_traffic_mix: [
    "channel_id",
    "video_id",
    "subscribed_status",
    "raw_type",
    "bucket",
    "views",
    "engaged_views",
    "share",
    "as_of",
  ],
  retention_curves: [
    "channel_id",
    "video_id",
    "audience",
    "bin",
    "elapsed_ratio",
    "audience_watch_ratio",
    "relative_retention",
    "started_watching",
    "stopped_watching",
    "total_segment_impressions",
    "s_mono",
    "hazard",
    "as_of",
  ],
  retention_coverage: [
    "channel_id",
    "video_id",
    "audience",
    "status",
    "points",
    "rewatch_bumps",
    "rewatch_mass",
    "as_of",
    "details",
  ],
  beats: [
    "channel_id",
    "video_id",
    "extraction_version",
    "beat_index",
    "start_s",
    "end_s",
    "beat_type",
    "extracted_at",
    "details",
  ],
  beat_videos: [
    "channel_id",
    "video_id",
    "extraction_version",
    "cache_key",
    "gemini_model",
    "video_mode",
    "format",
    "video_summary",
    "title_promise",
    "target_level",
    "payoff_time_s",
    "beat_count",
    "coverage",
    "duration_s",
    "extracted_at",
  ],
  quality_reports: ["report_id", "channel_id", "stage", "run_id", "created_at", "details"],
  extraction_runs: [
    "run_id",
    "channel_id",
    "video_id",
    "extraction_version",
    "gemini_model",
    "status",
    "started_at",
    "finished_at",
    "details",
  ],
  video_device_mix: [
    "channel_id",
    "video_id",
    "subscribed_status",
    "raw_type",
    "bucket",
    "views",
    "engaged_views",
    "share",
    "as_of",
  ],
};

export const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL(`../../../../../tests/fixtures/youtube/${name}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

/** The recorded Analytics response for a query, chosen by its dimensions. */
function reportFixture(query: AnalyticsQuery): Record<string, unknown> {
  switch (query.dimensions) {
    case "video,creatorContentType":
      return fixture("reports.query.content-type.json");
    case "video,subscribedStatus":
      return fixture("reports.query.stats.json");
    case "video,insightTrafficSourceType,subscribedStatus":
      return fixture("reports.query.traffic.json");
    case "video,deviceType,subscribedStatus":
      return fixture("reports.query.device.json");
    case "elapsedVideoTimeRatio":
      if (query.metrics.includes("startedWatching")) {
        return fixture("reports.query.retention-segments.json");
      }
      if (query.filters?.includes("subscribedStatus==SUBSCRIBED")) {
        return fixture("reports.query.retention.subscribed.json");
      }
      if (query.filters?.includes("subscribedStatus==UNSUBSCRIBED")) {
        return fixture("reports.query.retention.unsubscribed.json");
      }
      if (query.filters?.includes("audienceType==ORGANIC")) {
        return fixture("reports.query.retention.organic.json");
      }
      return fixture("reports.query.retention.all.json");
    default:
      throw new Error(`No fixture for dimensions=${query.dimensions}`);
  }
}

export type FakeYoutubeApi = { [K in keyof YoutubeApi]: Mock<YoutubeApi[K]> };

export async function ingestTestbed() {
  vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
  vi.stubEnv("BQ_DATASET", "soundcheck");
  vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
  vi.stubEnv("MIN_VIEWS", "500");
  const db = new FakeFirestore();
  const storage = new FakeStorage();
  const bigquery = new FakeBigQuery(
    Object.fromEntries(Object.keys(COLUMNS).map((table) => [table, []])),
    { columns: COLUMNS, storage },
  );
  setClientOverride("firestore", db.asFirestore());
  setClientOverride("bigquery", bigquery.asBigQuery());
  setClientOverride("storage", storage.asStorage());
  const gemini = new FakeGenAI();
  setClientOverride("genai", gemini.asGenAI());

  const channel: ChannelDoc = {
    userId: "111111111111111111111",
    title: "Fixture Channel",
    thumbnailUrl: null,
    subscriberCount: 8450,
    videoCount: 4,
    uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
    status: "connected",
    tokenCiphertext: "eA==",
    tokenScope: "openid",
    connectedAt: new Date("2026-10-01T10:00:00Z"),
    build: { state: "running" },
  };
  await db.collection("channels").doc(CHANNEL).set(channel);

  const api: FakeYoutubeApi = {
    uploadsPage: vi.fn(async () => fixture("playlistItems.list.uploads.json")),
    videos: vi.fn(async () => fixture("videos.list.uploads.json")),
    report: vi.fn(async (query: AnalyticsQuery) => reportFixture(query)),
    reportingJobs: vi.fn(async () => ({})),
    createReportingJob: vi.fn(async (reportTypeId: string) => ({
      id: `job-${reportTypeId}`,
      reportTypeId,
      name: `soundcheck ${reportTypeId}`,
      createTime: NOW.toISOString(),
    })),
  };
  const connect = vi.fn(async () => api as YoutubeApi);
  /** The raw response archived at `{source}/{key}`, parsed; undefined if none. */
  const archived = (path: string): unknown => {
    const text = storage.read(`gs://test-raw/${CHANNEL}/${path}/20261006.json`);
    return text === undefined ? undefined : JSON.parse(text);
  };
  return { db, storage, bigquery, gemini, api, connect, archived };
}

export function resetTestbed(): void {
  resetClients();
  vi.unstubAllEnvs();
  resetEnvCache();
}
