import { z } from "zod";
import { pickServerEnv } from "../env";
import { getBigQuery } from "../gcp";
import { channelIdSchema } from "../schemas";

/** BigQuery returns TIMESTAMP columns as `{ value: "…" }` objects. */
const timestampValue = z.union([
  z.string(),
  z.object({ value: z.string() }).transform((timestamp) => timestamp.value),
]);
const eligibleRowSchema = z.object({ video_id: z.string().min(1), published_at: timestampValue });

export interface EligibleVideo {
  id: string;
  publishedAt: string;
}

/** The channel's training-eligible videos from the `videos` table, oldest first. */
export async function eligibleVideos(channelId: string): Promise<EligibleVideo[]> {
  channelIdSchema.parse(channelId);
  const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_DATASET", "BQ_LOCATION"]);
  const [rows] = await getBigQuery().query({
    query: `SELECT video_id, published_at FROM \`${env.GCP_PROJECT_ID}.${env.BQ_DATASET}.videos\` WHERE channel_id = @channelId AND eligible ORDER BY published_at`,
    params: { channelId },
    location: env.BQ_LOCATION,
  });
  return z
    .array(eligibleRowSchema)
    .parse(rows)
    .map((row) => ({ id: row.video_id, publishedAt: row.published_at }));
}
