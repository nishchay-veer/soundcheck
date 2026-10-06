import { youtube, type youtube_v3 } from "@googleapis/youtube";
import { OAuth2Client } from "google-auth-library";
import { withRetry } from "../retry";
import { youtubeChannelListSchema, youtubePlaylistItemListSchema } from "../schemas";

export function youtubeClient(auth: OAuth2Client): youtube_v3.Youtube {
  return youtube({ version: "v3", auth });
}

/** An OAuth client that only carries a short-lived access token. */
export function accessTokenAuth(accessToken: string): OAuth2Client {
  const auth = new OAuth2Client();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

/** The authenticated user's channel (`mine: true`), as the raw API response body. */
export async function listMyChannels(auth: OAuth2Client): Promise<unknown> {
  const response = await withRetry(
    () =>
      youtubeClient(auth).channels.list({
        part: ["snippet", "statistics", "contentDetails"],
        mine: true,
      }),
    { operation: "youtube.channels.list" },
  );
  return response.data;
}

export interface ChannelInfo {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  subscriberCount: number | null;
  videoCount: number;
  uploadsPlaylistId: string;
}

/** Pure parser for a `channels.list` response; null when the account has no channel. */
export function parseMyChannel(body: unknown): ChannelInfo | null {
  const [channel] = youtubeChannelListSchema.parse(body).items ?? [];
  if (!channel) return null;
  const { thumbnails } = channel.snippet;
  const thumbnail = thumbnails?.high ?? thumbnails?.medium ?? thumbnails?.default;
  return {
    id: channel.id,
    title: channel.snippet.title,
    thumbnailUrl: thumbnail?.url ?? null,
    subscriberCount:
      channel.statistics.hiddenSubscriberCount || channel.statistics.subscriberCount === undefined
        ? null
        : Number(channel.statistics.subscriberCount),
    videoCount: Number(channel.statistics.videoCount),
    uploadsPlaylistId: channel.contentDetails.relatedPlaylists.uploads,
  };
}

export interface PlaylistVideo {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

/** Pure parser for a `playlistItems.list` response. */
export function parsePlaylistItems(body: unknown): PlaylistVideo[] {
  return (youtubePlaylistItemListSchema.parse(body).items ?? []).map((item) => ({
    videoId: item.contentDetails.videoId,
    title: item.snippet.title,
    publishedAt: item.contentDetails.videoPublishedAt ?? null,
  }));
}
