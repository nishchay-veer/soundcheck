import { NotFoundError } from "../errors";
import { getFirestore } from "../gcp";
import {
  COLLECTIONS,
  meResponseSchema,
  userDocSchema,
  type Channel,
  type ChannelSummary,
  type MeResponse,
} from "../schemas";
import { requireChannel } from "./authz";

/** The channel IDs on a user's document; empty when the user has none yet. */
export async function getUserChannelIds(userId: string): Promise<string[]> {
  const snapshot = await getFirestore().collection(COLLECTIONS.users).doc(userId).get();
  return snapshot.exists ? userDocSchema.parse(snapshot.data()).channelIds : [];
}

export function toChannelSummary(channel: Channel): ChannelSummary {
  return {
    id: channel.id,
    title: channel.title,
    thumbnailUrl: channel.thumbnailUrl,
    subscriberCount: channel.subscriberCount,
    videoCount: channel.videoCount,
    status: channel.status,
    connectedAt: channel.connectedAt.toISOString(),
    build: channel.build,
  };
}

/**
 * The signed-in user and the channels they own. Channel IDs on the user
 * document that no longer resolve to one of their channels are skipped.
 */
export async function getMe(userId: string): Promise<MeResponse> {
  const snapshot = await getFirestore().collection(COLLECTIONS.users).doc(userId).get();
  if (!snapshot.exists) throw new NotFoundError("user");
  const user = userDocSchema.parse(snapshot.data());

  const channels: ChannelSummary[] = [];
  for (const channelId of user.channelIds) {
    try {
      channels.push(toChannelSummary(await requireChannel(userId, channelId)));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return meResponseSchema.parse({ user: { id: userId, email: user.email }, channels });
}
