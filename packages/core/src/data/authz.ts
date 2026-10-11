import { NotFoundError } from "../errors";
import { COLLECTIONS, channelDocSchema, channelIdSchema, type Channel } from "../schemas";
import { readDocument } from "./store";

/**
 * Loads a channel the user owns. A malformed ID, a missing channel and someone
 * else's channel all throw the same NotFoundError (404), so channel IDs cannot
 * be probed. Every route handler and server component calls this with the
 * session's user ID before touching channel data.
 */
export async function requireChannel(userId: string, channelId: string): Promise<Channel> {
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  const data = await readDocument(`${COLLECTIONS.channels}/${channelId}`);
  if (data === undefined) throw new NotFoundError("channel");
  const channel = channelDocSchema.parse(data);
  if (channel.userId !== userId) throw new NotFoundError("channel");
  return { id: channelId, ...channel };
}
