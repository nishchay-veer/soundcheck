import type { TableField } from "@google-cloud/bigquery";
import type { Logger } from "pino";
import { pickServerEnv } from "../env";
import { getBigQuery, getStorage } from "../gcp";
import { childLogger, logger as rootLogger } from "../logger";
import { channelIdSchema } from "../schemas";

const TABLE_NAME = /^[A-Za-z_]\w*$/;
const RUN_ID = /^\w+$/;
/** Staging tables expire on their own if a job dies before dropping them. */
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export interface ReplaceRowsInput {
  table: string;
  channelId: string;
  /** JSON-serializable rows, already validated against the table's row schema. */
  rows: ReadonlyArray<Record<string, unknown>>;
  /** Unique per job run (letters, digits, `_`); names the staging object and table. */
  runId: string;
  log?: Logger;
}

/**
 * Replaces every row of `channelId` in `table` with `rows`, using load jobs
 * rather than streaming inserts (streamed rows cannot be deleted for about 90
 * minutes):
 *
 * 1. write the rows as NDJSON to `{channelId}/staging/{table}/{runId}.ndjson`
 *    in the raw bucket, so a channel deletion also covers it;
 * 2. load that file into a staging table with the target's schema;
 * 3. delete the channel's old rows and insert the new ones in one transaction;
 * 4. drop the staging table and object.
 *
 * A failure before step 3 leaves the old rows in place, so a re-run is safe.
 * Returns the number of rows written.
 */
export async function replaceChannelRows(input: ReplaceRowsInput): Promise<number> {
  const { table, channelId, rows, runId } = input;
  channelIdSchema.parse(channelId);
  if (!TABLE_NAME.test(table)) throw new RangeError(`Invalid table name: ${table}`);
  if (!RUN_ID.test(runId)) throw new RangeError(`Invalid run ID: ${runId}`);
  const foreign = rows.find((row) => row.channel_id !== channelId);
  if (foreign) {
    throw new Error(
      `A row for ${String(foreign.channel_id)} is in a ${table} load for ${channelId}`,
    );
  }

  const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_DATASET", "BQ_LOCATION", "GCS_RAW_BUCKET"]);
  const log = childLogger(
    { channel_id: channelId, stage: "load", run_id: runId, table },
    input.log ?? rootLogger,
  );
  const bigquery = getBigQuery();
  const dataset = bigquery.dataset(env.BQ_DATASET);
  const target = `${env.GCP_PROJECT_ID}.${env.BQ_DATASET}.${table}`;

  const run = async (query: string) => {
    const [job] = await bigquery.createQueryJob({
      query,
      params: { channelId },
      location: env.BQ_LOCATION,
    });
    await job.getQueryResults();
  };

  if (rows.length === 0) {
    await run(`DELETE FROM \`${target}\` WHERE channel_id = @channelId`);
    log.info({ rows: 0 }, "rows replaced");
    return 0;
  }

  const [metadata] = await dataset.table(table).getMetadata();
  const fields = (metadata as { schema: { fields: TableField[] } }).schema.fields;
  const columns = fields.map((field) => `\`${String(field.name)}\``).join(", ");
  const stagingId = `_staging_${table}_${runId}`;
  const objectName = `${channelId}/staging/${table}/${runId}.ndjson`;
  const file = getStorage().bucket(env.GCS_RAW_BUCKET).file(objectName);
  const staging = dataset.table(stagingId);

  try {
    await file.save(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, {
      resumable: false,
      contentType: "application/x-ndjson",
    });
    await dataset.createTable(stagingId, {
      schema: { fields },
      expirationTime: String(Date.now() + STAGING_TTL_MS),
    });
    const [loadJob] = await bigquery.createJob({
      configuration: {
        load: {
          sourceUris: [`gs://${env.GCS_RAW_BUCKET}/${objectName}`],
          sourceFormat: "NEWLINE_DELIMITED_JSON",
          destinationTable: {
            projectId: env.GCP_PROJECT_ID,
            datasetId: env.BQ_DATASET,
            tableId: stagingId,
          },
          writeDisposition: "WRITE_EMPTY",
        },
      },
      location: env.BQ_LOCATION,
    });
    await loadJob.promise();
    await run(
      [
        "BEGIN TRANSACTION;",
        `DELETE FROM \`${target}\` WHERE channel_id = @channelId;`,
        `INSERT INTO \`${target}\` (${columns}) SELECT ${columns} FROM \`${env.GCP_PROJECT_ID}.${env.BQ_DATASET}.${stagingId}\` WHERE channel_id = @channelId;`,
        "COMMIT TRANSACTION;",
      ].join("\n"),
    );
  } finally {
    const cleanup = await Promise.allSettled([
      staging.delete({ ignoreNotFound: true }),
      file.delete({ ignoreNotFound: true }),
    ]);
    for (const result of cleanup) {
      if (result.status === "rejected") {
        log.warn(
          { err: result.reason },
          "staging cleanup failed; the staging table expires in a day",
        );
      }
    }
  }
  log.info({ rows: rows.length }, "rows replaced");
  return rows.length;
}
