import type { Logger } from "pino";
import { encryptRefreshToken } from "../crypto/tokens";
import { ChannelOwnedError, MissingScopesError, NoChannelError } from "../errors";
import { getFirestore } from "../gcp";
import { childLogger, logger as rootLogger } from "../logger";
import { COLLECTIONS, channelDocSchema, userDocSchema } from "../schemas";
import { accessTokenAuth, listMyChannels, parseMyChannel } from "../youtube/client";

/** Both are required; users can untick either one on the consent screen. */
export const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;

export interface ConnectChannelInput {
  /** The Google account's `sub`; becomes the user ID. */
  googleSub: string;
  email: string;
  /** Used once to read the channel, never stored. */
  accessToken: string;
  refreshToken: string | undefined;
  /** Access token expiry (epoch seconds). Not stored: access tokens are never persisted. */
  expiresAt?: number;
  /** Space-separated scopes Google actually granted. */
  scope: string;
}

export interface ConnectChannelResult {
  userId: string;
  channelId: string;
  /** False when an existing connection was refreshed. */
  created: boolean;
}

export function missingYoutubeScopes(scope: string): string[] {
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return YOUTUBE_SCOPES.filter((required) => !granted.has(required));
}

const channelProfileSchema = channelDocSchema.omit({ connectedAt: true, build: true });
const userUpdateSchema = userDocSchema.pick({ email: true, channelIds: true, lastSignInAt: true });

/**
 * Called once per sign-in. Checks scopes, reads the user's channel, encrypts
 * the refresh token with KMS and upserts `users/{userId}` and
 * `channels/{channelId}`. A first connection starts the channel build; a
 * reconnection only replaces the token and profile, keeping the original
 * connection time and build progress.
 */
export async function connectChannel(
  input: ConnectChannelInput,
  log: Logger = rootLogger,
): Promise<ConnectChannelResult> {
  const missing = missingYoutubeScopes(input.scope);
  if (missing.length > 0) throw new MissingScopesError(missing);
  if (!input.refreshToken) {
    throw new Error("Google returned no refresh token; sign-in must request offline access");
  }

  const userId = input.googleSub;
  const channel = parseMyChannel(await listMyChannels(accessTokenAuth(input.accessToken)));
  if (!channel) throw new NoChannelError();

  const tokenCiphertext = await encryptRefreshToken(userId, input.refreshToken);
  const db = getFirestore();
  const channelRef = db.collection(COLLECTIONS.channels).doc(channel.id);
  const userRef = db.collection(COLLECTIONS.users).doc(userId);
  const now = new Date();

  const created = await db.runTransaction(async (tx) => {
    const [channelSnapshot, userSnapshot] = await Promise.all([
      tx.get(channelRef),
      tx.get(userRef),
    ]);
    const existing = channelSnapshot.exists
      ? channelDocSchema.parse(channelSnapshot.data())
      : undefined;
    if (existing && existing.userId !== userId) throw new ChannelOwnedError(channel.id);
    const user = userSnapshot.exists ? userDocSchema.parse(userSnapshot.data()) : undefined;

    const profile = channelProfileSchema.parse({
      userId,
      title: channel.title,
      thumbnailUrl: channel.thumbnailUrl,
      subscriberCount: channel.subscriberCount,
      videoCount: channel.videoCount,
      uploadsPlaylistId: channel.uploadsPlaylistId,
      status: "connected",
      tokenCiphertext,
      tokenScope: input.scope,
    });
    if (existing) {
      tx.set(channelRef, profile, { merge: true });
    } else {
      tx.set(
        channelRef,
        channelDocSchema.parse({ ...profile, connectedAt: now, build: { state: "not_started" } }),
      );
    }

    const channelIds = [...new Set([...(user?.channelIds ?? []), channel.id])];
    tx.set(
      userRef,
      user
        ? userUpdateSchema.parse({ email: input.email, channelIds, lastSignInAt: now })
        : userDocSchema.parse({
            email: input.email,
            channelIds,
            createdAt: now,
            lastSignInAt: now,
          }),
      { merge: true },
    );
    return existing === undefined;
  });

  childLogger({ channel_id: channel.id, stage: "connect" }, log).info(
    { created },
    created ? "channel connected" : "channel reconnected",
  );
  if (created) await startChannelBuild(channel.id, log);
  return { userId, channelId: channel.id, created };
}

/** Starts the `channel_build` workflow. A no-op until Phase 10 wires it to Workflows. */
export async function startChannelBuild(
  channelId: string,
  log: Logger = rootLogger,
): Promise<void> {
  childLogger({ channel_id: channelId, stage: "build" }, log).info(
    "channel build not started: Workflows are wired in Phase 10",
  );
}
