import { pickServerEnv } from "../env";
import { getBigQuery } from "../gcp";
import { channelIdSchema } from "../schemas";

const NAME = /^[A-Za-z_]\w*$/;

/**
 * Some columns of a channel's rows in `table`, for pipeline steps that build
 * on earlier ones. Never used on a request path (rule 11). Callers validate
 * the rows they get back.
 */
export async function readChannelRows(
  table: string,
  columns: readonly string[],
  channelId: string,
): Promise<Array<Record<string, unknown>>> {
  channelIdSchema.parse(channelId);
  for (const name of [table, ...columns]) {
    if (!NAME.test(name)) throw new RangeError(`Invalid table or column name: ${name}`);
  }
  if (columns.length === 0) throw new RangeError("readChannelRows needs at least one column");
  const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_DATASET", "BQ_LOCATION"]);
  const [rows] = await getBigQuery().query({
    query: `SELECT ${columns.join(", ")} FROM \`${env.GCP_PROJECT_ID}.${env.BQ_DATASET}.${table}\` WHERE channel_id = @channelId`,
    params: { channelId },
    location: env.BQ_LOCATION,
  });
  return rows as Array<Record<string, unknown>>;
}
