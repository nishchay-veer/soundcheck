import { youtubereporting, type youtubereporting_v1 } from "@googleapis/youtubereporting";
import type { OAuth2Client } from "google-auth-library";
import type { Logger } from "pino";
import { withRetry } from "../retry";
import { reportingJobListSchema, reportingJobSchema } from "../schemas";

/**
 * Reach reports (thumbnail impressions and click-through rate per video and
 * day), added to the Reporting API on Jan 15, 2026. YouTube only generates
 * them from the day a job is created, and the first can take 48 hours, so
 * ingest starts the jobs early for packaging (Phase 16) to read.
 */
export const REACH_REPORT_TYPES = ["channel_reach_basic_a1", "channel_reach_combined_a1"] as const;

export function reportingClient(auth: OAuth2Client): youtubereporting_v1.Youtubereporting {
  return youtubereporting({ version: "v1", auth });
}

/** One page of the channel's reporting jobs, as the raw response body. */
export async function listReportingJobs(
  auth: OAuth2Client,
  pageToken?: string,
  log?: Logger,
): Promise<unknown> {
  const response = await withRetry(
    () => reportingClient(auth).jobs.list({ ...(pageToken ? { pageToken } : {}) }),
    { operation: "youtube.reporting.jobs.list", logger: log },
  );
  return response.data;
}

/** Creates a job for `reportTypeId`; returns the raw response body (the job). */
export async function createReportingJob(
  auth: OAuth2Client,
  reportTypeId: string,
  log?: Logger,
): Promise<unknown> {
  const response = await withRetry(
    () =>
      reportingClient(auth).jobs.create({
        requestBody: { reportTypeId, name: `soundcheck ${reportTypeId}` },
      }),
    { operation: "youtube.reporting.jobs.create", logger: log },
  );
  return response.data;
}

export interface ReportingJob {
  id: string;
  reportTypeId: string;
}

/** Pure parser for a `jobs.list` page. */
export function parseReportingJobs(body: unknown): {
  jobs: ReportingJob[];
  nextPageToken: string | null;
} {
  const page = reportingJobListSchema.parse(body);
  return {
    jobs: (page.jobs ?? []).map(({ id, reportTypeId }) => ({ id, reportTypeId })),
    nextPageToken: page.nextPageToken ?? null,
  };
}

/** Pure parser for a created job. */
export function parseReportingJob(body: unknown): ReportingJob {
  const { id, reportTypeId } = reportingJobSchema.parse(body);
  return { id, reportTypeId };
}
