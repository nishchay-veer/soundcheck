import { NotFoundError } from "../errors";
import {
  COLLECTIONS,
  meResponseSchema,
  userDocSchema,
  type Build,
  type BuildView,
  type Channel,
  type ChannelView,
  type MeResponse,
} from "../schemas";
import { requireChannel } from "./authz";
import { readDocument } from "./store";

/** The channel IDs on a user's document; empty when the user has none yet. */
export async function getUserChannelIds(userId: string): Promise<string[]> {
  const data = await readDocument(`${COLLECTIONS.users}/${userId}`);
  return data === undefined ? [] : userDocSchema.parse(data).channelIds;
}

/** A build as the browser sees it: ISO dates, and no Workflows execution path. */
export function toBuildView(build: Build): BuildView {
  return {
    state: build.state,
    runId: build.runId,
    mode: build.mode,
    stage: build.stage,
    stageStartedAt: build.stageStartedAt?.toISOString(),
    startedAt: build.startedAt?.toISOString(),
    finishedAt: build.finishedAt?.toISOString(),
    error: build.error,
    eligibleVideos: build.eligibleVideos,
    usableVideos: build.usableVideos,
    progress: build.progress && {
      ...build.progress,
      updatedAt: build.progress.updatedAt.toISOString(),
    },
  };
}

/** A channel as the browser sees it: never the token ciphertext or scopes. */
export function toChannelView(channel: Channel): ChannelView {
  return {
    id: channel.id,
    title: channel.title,
    thumbnailUrl: channel.thumbnailUrl,
    subscriberCount: channel.subscriberCount,
    videoCount: channel.videoCount,
    status: channel.status,
    connectedAt: channel.connectedAt.toISOString(),
    build: toBuildView(channel.build),
  };
}

/**
 * The signed-in user and the channels they own. Channel IDs on the user
 * document that no longer resolve to one of their channels are skipped.
 */
export async function getMe(userId: string): Promise<MeResponse> {
  const data = await readDocument(`${COLLECTIONS.users}/${userId}`);
  if (data === undefined) throw new NotFoundError("user");
  const user = userDocSchema.parse(data);

  const channels: ChannelView[] = [];
  for (const channelId of user.channelIds) {
    try {
      channels.push(toChannelView(await requireChannel(userId, channelId)));
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }
  return meResponseSchema.parse({ user: { id: userId, email: user.email }, channels });
}
