import { randomUUID } from "node:crypto";
import { INGEST_VERSION, childLogger, logger as rootLogger, type Logger } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import {
  archiveRaw,
  isStepDone,
  markStepDone,
  progressWriter,
  type ProgressWriter,
} from "@soundcheck/core/jobs";
import type { Channel } from "@soundcheck/core/schemas";
import {
  analyticsEndDate,
  createReportingJob,
  credentialsForChannel,
  fetchUploadsPage,
  fetchVideos,
  listReportingJobs,
  queryReport,
  type AnalyticsQuery,
  type QueryOptions,
} from "@soundcheck/core/youtube";

type UploadsPageRequest = Parameters<typeof fetchUploadsPage>[1];
type VideosRequest = Parameters<typeof fetchVideos>[1];

/** The YouTube calls ingest makes, each returning the raw response body. Tests replay fixtures. */
export interface YoutubeApi {
  uploadsPage(request: UploadsPageRequest): Promise<unknown>;
  videos(request: VideosRequest): Promise<unknown>;
  report(query: AnalyticsQuery, options?: Pick<QueryOptions, "maxAttempts">): Promise<unknown>;
  reportingJobs(pageToken?: string): Promise<unknown>;
  createReportingJob(reportTypeId: string): Promise<unknown>;
}

/** The real API, with the channel's stored credentials. */
export async function connectYoutube(channelId: string, log: Logger): Promise<YoutubeApi> {
  const auth = await credentialsForChannel(channelId, log);
  return {
    uploadsPage: (request) => fetchUploadsPage(auth, request, log),
    videos: (request) => fetchVideos(auth, request, log),
    report: (query, options) => queryReport(auth, query, { log, ...options }),
    reportingJobs: (pageToken) => listReportingJobs(auth, pageToken, log),
    createReportingJob: (reportTypeId) => createReportingJob(auth, reportTypeId, log),
  };
}

export interface IngestOptions {
  channelId: string;
  /** Redo the step even if it already finished for this data date. */
  force?: boolean;
  now?: Date;
  log?: Logger;
  connect?: (channelId: string, log: Logger) => Promise<YoutubeApi>;
}

/** `batch-001`, `page-002`: raw archive keys that sort in fetch order. */
export const archiveKey = (kind: "page" | "batch", index: number): string =>
  `${kind}-${String(index + 1).padStart(3, "0")}`;

/**
 * One run of an ingest step for one channel. Every fetch goes through here so
 * the raw body is archived before anything parses it (CLAUDE.md rule 6) and
 * API usage is counted for the run's log line.
 */
export class IngestRun {
  readonly runId = randomUUID().replaceAll("-", "");
  readonly calls = { dataApiUnits: 0, analyticsQueries: 0, reportingCalls: 0 };
  readonly log: Logger;
  readonly progress: ProgressWriter;

  constructor(
    readonly step: string,
    readonly channel: Channel,
    /** The last day Analytics data covers; also the step's data date. */
    readonly asOf: string,
    readonly startedAt: Date,
    log: Logger,
    private readonly api: YoutubeApi,
  ) {
    this.log = childLogger({ run_id: this.runId }, log);
    this.progress = progressWriter(channel.id, "ingest", { log: this.log });
  }

  async uploadsPage(key: string, request: UploadsPageRequest): Promise<unknown> {
    this.calls.dataApiUnits += 1;
    return this.archive(
      "youtube-playlist-items",
      key,
      request,
      await this.api.uploadsPage(request),
    );
  }

  async videos(key: string, request: VideosRequest): Promise<unknown> {
    this.calls.dataApiUnits += 1;
    return this.archive("youtube-videos", key, request, await this.api.videos(request));
  }

  async report(
    source: string,
    key: string,
    query: AnalyticsQuery,
    options?: Pick<QueryOptions, "maxAttempts">,
  ): Promise<unknown> {
    this.calls.analyticsQueries += 1;
    const body = await (options ? this.api.report(query, options) : this.api.report(query));
    return this.archive(source, key, query, body);
  }

  async reportingJobs(key: string, pageToken?: string): Promise<unknown> {
    this.calls.reportingCalls += 1;
    const body = await this.api.reportingJobs(pageToken);
    return this.archive("reporting-jobs", key, { pageToken }, body);
  }

  async createReportingJob(reportTypeId: string): Promise<unknown> {
    this.calls.reportingCalls += 1;
    const body = await this.api.createReportingJob(reportTypeId);
    return this.archive("reporting-jobs", `create-${reportTypeId}`, { reportTypeId }, body);
  }

  private async archive(source: string, key: string, request: unknown, body: unknown) {
    await archiveRaw({
      channelId: this.channel.id,
      source,
      key,
      body,
      request,
      fetchedAt: this.startedAt,
    });
    return body;
  }

  /** Records the step as done for this data date and logs a summary. */
  async finish(rows: Record<string, number>, summary: Record<string, unknown> = {}): Promise<void> {
    await this.progress.flush();
    await markStepDone(this.channel.id, this.step, {
      asOf: this.asOf,
      version: INGEST_VERSION,
      rows,
    });
    this.log.info(
      {
        ...summary,
        rows,
        as_of: this.asOf,
        data_api_units: this.calls.dataApiUnits,
        analytics_queries: this.calls.analyticsQueries,
        reporting_calls: this.calls.reportingCalls,
        duration_ms: Date.now() - this.startedAt.getTime(),
      },
      `${this.step} finished`,
    );
  }
}

/**
 * Starts `step` for a channel, or returns undefined when it already finished
 * for the current data date and version (CLAUDE.md rule 7) and `force` is off.
 */
export async function startIngest(
  step: string,
  options: IngestOptions,
): Promise<IngestRun | undefined> {
  const { channelId, force = false, now = new Date(), connect = connectYoutube } = options;
  const asOf = analyticsEndDate(now);
  const log = childLogger({ channel_id: channelId, stage: step }, options.log ?? rootLogger);

  if (!force && (await isStepDone(channelId, step, { asOf, version: INGEST_VERSION }))) {
    log.info(
      { as_of: asOf },
      `${step} already done for this data date; skipping (--force redoes it)`,
    );
    return undefined;
  }
  const channel = await loadChannel(channelId);
  const api = await connect(channelId, log);
  return new IngestRun(step, channel, asOf, now, log, api);
}
