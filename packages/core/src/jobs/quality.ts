import type { Logger } from "pino";
import { pickServerEnv } from "../env";
import { getBigQuery, getStorage } from "../gcp";
import { logger as rootLogger } from "../logger";
import { channelIdSchema, qualityReportRowSchema, type QualityReportRow } from "../schemas";
import { replaceChannelRows } from "./bigquery-load";

/**
 * Quality reports are kept as JSON in the raw bucket, one file per report, and
 * the `quality_reports` table is rebuilt from all of them: every iteration of
 * a quality gate stays in the history.
 */

const rawBucket = () => getStorage().bucket(pickServerEnv(["GCS_RAW_BUCKET"]).GCS_RAW_BUCKET);
const prefix = (channelId: string) => `${channelIdSchema.parse(channelId)}/quality-reports/`;

/** Stores a report at `{channel}/quality-reports/{report_id}.json`. */
export async function writeQualityReport(report: QualityReportRow): Promise<string> {
  const row = qualityReportRowSchema.parse(report);
  const name = `${prefix(row.channel_id)}${row.report_id}.json`;
  await rawBucket()
    .file(name)
    .save(JSON.stringify(row), { resumable: false, contentType: "application/json" });
  return name;
}

/** Every stored report for the channel, oldest first. Unreadable files are skipped. */
export async function readQualityReports(channelId: string): Promise<QualityReportRow[]> {
  const bucket = rawBucket();
  const [files] = await bucket.getFiles({ prefix: prefix(channelId) });
  const reports: QualityReportRow[] = [];
  for (const { name } of files) {
    const [contents] = await bucket.file(name).download();
    try {
      const report = qualityReportRowSchema.safeParse(JSON.parse(contents.toString("utf8")));
      if (report.success) reports.push(report.data);
    } catch {
      // A corrupt file is skipped rather than failing the load.
    }
  }
  return reports.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/** Rebuilds the channel's `quality_reports` rows from the stored reports. */
export async function loadQualityReports(
  channelId: string,
  { runId, log = rootLogger }: { runId: string; log?: Logger },
): Promise<number> {
  const reports = await readQualityReports(channelId);
  await replaceChannelRows({ table: "quality_reports", channelId, rows: reports, runId, log });
  return reports.length;
}

/**
 * The latest report of `stage` about `extractionVersion` from any channel, with
 * whether it passed: a quality gate runs on one test channel, and its verdict
 * covers every channel. Null if there is none.
 */
export async function latestQualityVerdict(
  stage: string,
  extractionVersion: string,
): Promise<{ reportId: string; channelId: string; passed: boolean } | null> {
  const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_DATASET", "BQ_LOCATION"]);
  const [rows] = await getBigQuery().query({
    query: `SELECT report_id, channel_id, JSON_VALUE(details, '$.passed') AS passed FROM \`${env.GCP_PROJECT_ID}.${env.BQ_DATASET}.quality_reports\` WHERE stage = @stage AND JSON_VALUE(details, '$.extraction_version') = @version ORDER BY created_at DESC LIMIT 1`,
    params: { stage, version: extractionVersion },
    location: env.BQ_LOCATION,
  });
  const [row] = rows as Array<{ report_id: string; channel_id: string; passed: string | null }>;
  return row
    ? { reportId: row.report_id, channelId: row.channel_id, passed: row.passed === "true" }
    : null;
}
