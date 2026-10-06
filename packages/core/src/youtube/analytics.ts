import { youtubeAnalytics, type youtubeAnalytics_v2 } from "@googleapis/youtubeanalytics";
import type { OAuth2Client } from "google-auth-library";
import type { Logger } from "pino";
import { withRetry } from "../retry";
import { analyticsReportSchema } from "../schemas";

export function analyticsClient(auth: OAuth2Client): youtubeAnalytics_v2.Youtubeanalytics {
  return youtubeAnalytics({ version: "v2", auth });
}

/** A `reports.query` request; `ids` is always the authenticated channel. */
export interface AnalyticsQuery {
  /** `YYYY-MM-DD`, Pacific time. */
  startDate: string;
  endDate: string;
  metrics: string;
  dimensions?: string;
  filters?: string;
  sort?: string;
  maxResults?: number;
  /** One-based. */
  startIndex?: number;
}

/** Runs one Analytics query and returns the raw response body, to archive before parsing. */
export async function queryReport(
  auth: OAuth2Client,
  query: AnalyticsQuery,
  log?: Logger,
): Promise<unknown> {
  const response = await withRetry(
    () => analyticsClient(auth).reports.query({ ids: "channel==MINE", ...query }),
    { operation: "youtube.analytics.reports.query", logger: log },
  );
  return response.data;
}

export type ReportRow = Record<string, string | number | null>;

/** Pure parser: one object per result row, keyed by column name. No data gives `[]`. */
export function reportRows(body: unknown): ReportRow[] {
  const report = analyticsReportSchema.parse(body);
  const names = report.columnHeaders.map((header) => header.name);
  return (report.rows ?? []).map((row) => {
    if (row.length !== names.length) {
      throw new Error(`Analytics row has ${row.length} values for ${names.length} columns`);
    }
    return Object.fromEntries(names.map((name, index) => [name, row[index] ?? null]));
  });
}

/**
 * Analytics data lags 48 to 72 hours, and the API quietly truncates a later
 * end date, so queries end three days before today.
 */
export const ANALYTICS_LAG_DAYS = 3;

const pacific = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The `YYYY-MM-DD` date of `instant` in Pacific time, the time zone Analytics reports use. */
export function pacificDate(instant: Date): string {
  const parts = Object.fromEntries(pacific.formatToParts(instant).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Adds whole days to a `YYYY-MM-DD` date. */
export function addDays(date: string, days: number): string {
  const result = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(result.getTime())) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

/** The last day an Analytics query should cover when run at `now`. */
export function analyticsEndDate(now: Date = new Date()): string {
  return addDays(pacificDate(now), -ANALYTICS_LAG_DAYS);
}
