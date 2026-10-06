/**
 * In-memory stand-in for the BigQuery calls core makes, for unit tests: rows
 * per table, an INFORMATION_SCHEMA lookup for `channel_id` columns, and
 * parameterized `DELETE … WHERE channel_id = @channelId` jobs.
 */
import type { BigQuery } from "@google-cloud/bigquery";

type Row = Record<string, unknown>;

export class FakeBigQuery {
  readonly queries: Array<{ query: string; params?: Record<string, unknown>; location?: string }> =
    [];
  /** Set to make every DELETE fail, e.g. like rows still in the streaming buffer. */
  failDeletes: Error | undefined;

  constructor(readonly tables: Record<string, Row[]>) {}

  async query(options: { query: string; location?: string }) {
    this.queries.push(options);
    if (!options.query.includes("INFORMATION_SCHEMA.COLUMNS"))
      throw new Error(`Unexpected query: ${options.query}`);
    return [
      Object.keys(this.tables)
        .sort()
        .map((table_name) => ({ table_name })),
    ] as const;
  }

  async createQueryJob(options: {
    query: string;
    params?: Record<string, unknown>;
    location?: string;
  }) {
    this.queries.push(options);
    const match = /^DELETE FROM `[^`]+\.([^.`]+)` WHERE channel_id = @channelId$/.exec(
      options.query,
    );
    if (!match?.[1]) throw new Error(`Unexpected job: ${options.query}`);
    if (this.failDeletes) throw this.failDeletes;
    const rows = this.tables[match[1]] ?? [];
    const kept = rows.filter((row) => row.channel_id !== options.params?.channelId);
    this.tables[match[1]] = kept;
    const affected = rows.length - kept.length;
    const job = {
      getQueryResults: async () => [[]] as const,
      getMetadata: async () =>
        [{ statistics: { query: { numDmlAffectedRows: String(affected) } } }] as const,
    };
    return [job] as const;
  }

  asBigQuery(): BigQuery {
    return this as unknown as BigQuery;
  }
}
