import { NotFoundError } from "../errors";
import { getFirestore } from "../gcp";
import { COLLECTIONS, channelDocSchema, channelIdSchema, type Channel } from "../schemas";

/**
 * Loads a channel the user owns. A malformed ID, a missing channel and someone
 * else's channel all throw the same NotFoundError (404), so channel IDs cannot
 * be probed. Every route handler and server component calls this with the
 * session's user ID before touching channel data.
 */
export async function requireChannel(userId: string, channelId: string): Promise<Channel> {
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  const snapshot = await getFirestore().collection(COLLECTIONS.channels).doc(channelId).get();
  if (!snapshot.exists) throw new NotFoundError("channel");
  const channel = channelDocSchema.parse(snapshot.data());
  if (channel.userId !== userId) throw new NotFoundError("channel");
  return { id: channelId, ...channel };
}
