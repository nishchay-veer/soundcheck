import pLimit from "p-limit";
import type { Logger } from "pino";
import { decryptRefreshToken } from "../crypto/tokens";
import { pickServerEnv } from "../env";
import { getBigQuery, getFirestore, getStorage } from "../gcp";
import { childLogger, logger as rootLogger } from "../logger";
import { withRetry } from "../retry";
import {
  COLLECTIONS,
  channelDeletionSchema,
  userDocSchema,
  type ChannelDeletion,
} from "../schemas";
import { requireChannel } from "./authz";

const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Revokes the refresh token at Google. A token Google already rejects
 * (`400 invalid_token`) counts as gone; 429 and 5xx are retried.
 */
async function revokeToken(token: string): Promise<boolean> {
  return withRetry(
    async () => {
      const response = await fetch(REVOKE_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }),
      });
      if (response.ok) return true;
      if (response.status === 400) return false;
      throw Object.assign(new Error(`Token revocation failed: HTTP ${response.status}`), {
        status: response.status,
      });
    },
    { operation: "oauth2.revoke" },
  );
}

/** Deletes the channel's rows from every table in the dataset that has a channel_id column. */
async function deleteBigQueryRows(channelId: string): Promise<Record<string, number>> {
  const env = pickServerEnv(["GCP_PROJECT_ID", "BQ_DATASET", "BQ_LOCATION"]);
  const dataset = `${env.GCP_PROJECT_ID}.${env.BQ_DATASET}`;
  const bigquery = getBigQuery();
  const [tables] = await bigquery.query({
    query: `SELECT table_name FROM \`${dataset}\`.INFORMATION_SCHEMA.COLUMNS WHERE column_name = 'channel_id' ORDER BY table_name`,
    location: env.BQ_LOCATION,
  });

  // DML jobs on different tables run concurrently; one after another took ~4 s each.
  const limit = pLimit(8);
  const counts = await Promise.all(
    (tables as Array<{ table_name: string }>).map(({ table_name: table }) =>
      limit(async () => {
        // The table name comes from INFORMATION_SCHEMA; the channel ID is a parameter.
        const [job] = await bigquery.createQueryJob({
          query: `DELETE FROM \`${dataset}.${table}\` WHERE channel_id = @channelId`,
          params: { channelId },
          location: env.BQ_LOCATION,
        });
        await job.getQueryResults();
        const [metadata] = await job.getMetadata();
        return [table, Number(metadata.statistics?.query?.numDmlAffectedRows ?? 0)] as const;
      }),
    ),
  );
  const deleted: Record<string, number> = Object.fromEntries(counts);
  return deleted;
}

/** Deletes every object under `{channelId}/` in the raw, uploads and media buckets. */
async function deleteStorageObjects(channelId: string): Promise<Record<string, number>> {
  const env = pickServerEnv(["GCS_RAW_BUCKET", "GCS_UPLOADS_BUCKET", "GCS_MEDIA_BUCKET"]);
  const limit = pLimit(16);
  const deleted: Record<string, number> = {};
  for (const bucketName of [env.GCS_RAW_BUCKET, env.GCS_UPLOADS_BUCKET, env.GCS_MEDIA_BUCKET]) {
    const [files] = await getStorage()
      .bucket(bucketName)
      .getFiles({ prefix: `${channelId}/` });
    await Promise.all(files.map((file) => limit(() => file.delete({ ignoreNotFound: true }))));
    deleted[bucketName] = files.length;
  }
  return deleted;
}

/**
 * Deletes a channel and every trace of it, for its owner only: revokes the
 * refresh token, deletes its BigQuery rows and Cloud Storage objects, then its
 * Firestore documents. Firestore goes last so a failure part-way leaves the
 * channel in place and the request can simply be repeated.
 *
 * All per-channel Firestore data must live under `channels/{channelId}`;
 * BigQuery tables must carry `channel_id`; GCS objects must sit under the
 * `{channelId}/` prefix. That is what makes this complete.
 */
export async function deleteChannel(
  userId: string,
  channelId: string,
  log: Logger = rootLogger,
): Promise<ChannelDeletion> {
  const channel = await requireChannel(userId, channelId);
  const channelLog = childLogger({ channel_id: channelId, stage: "delete" }, log);

  let tokenRevoked = false;
  try {
    tokenRevoked = await revokeToken(await decryptRefreshToken(userId, channel.tokenCiphertext));
  } catch (error) {
    // The data deletion matters more than the revocation; the user can also
    // revoke at myaccount.google.com.
    channelLog.warn({ err: error }, "token revocation failed; continuing with deletion");
  }

  const bigqueryRowsDeleted = await deleteBigQueryRows(channelId);
  const storageObjectsDeleted = await deleteStorageObjects(channelId);

  const db = getFirestore();
  const userRef = db.collection(COLLECTIONS.users).doc(userId);
  const userSnapshot = await userRef.get();
  if (userSnapshot.exists) {
    const user = userDocSchema.parse(userSnapshot.data());
    await userRef.set(
      { channelIds: user.channelIds.filter((id) => id !== channelId) },
      { merge: true },
    );
  }
  await db.recursiveDelete(db.collection(COLLECTIONS.channels).doc(channelId));

  const result = channelDeletionSchema.parse({
    channelId,
    tokenRevoked,
    bigqueryRowsDeleted,
    storageObjectsDeleted,
  });
  channelLog.info(result, "channel deleted");
  return result;
}
