import type { youtube_v3 } from "@googleapis/youtube";
import type { OAuth2Client } from "google-auth-library";
import type { Logger } from "pino";
import { withRetry } from "../retry";
import { youtubePlaylistItemListSchema, youtubeVideoListSchema } from "../schemas";
import { youtubeClient } from "./client";
import { parseIsoDuration } from "./duration";

/** `videos.list` and `playlistItems.list` both accept at most 50 IDs or items per call. */
export const DATA_API_PAGE_SIZE = 50;

/** One page of the uploads playlist. Costs 1 quota unit. */
export function uploadsPageRequest(
  playlistId: string,
  pageToken?: string,
): youtube_v3.Params$Resource$Playlistitems$List {
  return {
    part: ["snippet", "contentDetails"],
    playlistId,
    maxResults: DATA_API_PAGE_SIZE,
    ...(pageToken ? { pageToken } : {}),
  };
}

/** Up to 50 videos with everything ingest stores. Costs 1 quota unit. */
export function videosRequest(videoIds: readonly string[]): youtube_v3.Params$Resource$Videos$List {
  if (videoIds.length === 0 || videoIds.length > DATA_API_PAGE_SIZE) {
    throw new RangeError(
      `videos.list takes 1 to ${DATA_API_PAGE_SIZE} IDs, got ${videoIds.length}`,
    );
  }
  return {
    part: ["snippet", "contentDetails", "statistics", "status", "liveStreamingDetails"],
    id: [...videoIds],
    maxResults: DATA_API_PAGE_SIZE,
  };
}

export async function fetchUploadsPage(
  auth: OAuth2Client,
  request: youtube_v3.Params$Resource$Playlistitems$List,
  log?: Logger,
): Promise<unknown> {
  const response = await withRetry(() => youtubeClient(auth).playlistItems.list(request), {
    operation: "youtube.playlistItems.list",
    logger: log,
  });
  return response.data;
}

export async function fetchVideos(
  auth: OAuth2Client,
  request: youtube_v3.Params$Resource$Videos$List,
  log?: Logger,
): Promise<unknown> {
  const response = await withRetry(() => youtubeClient(auth).videos.list(request), {
    operation: "youtube.videos.list",
    logger: log,
  });
  return response.data;
}

/** Pure parser for an uploads page: video IDs in playlist order, newest first. */
export function parseUploadsPage(body: unknown): {
  videoIds: string[];
  nextPageToken: string | null;
} {
  const page = youtubePlaylistItemListSchema.parse(body);
  return {
    videoIds: (page.items ?? []).map((item) => item.contentDetails.videoId),
    nextPageToken: page.nextPageToken ?? null,
  };
}

export interface VideoMetadata {
  id: string;
  title: string;
  description: string;
  publishedAt: string;
  durationS: number;
  /** Public view count; since Aug 27, 2026 it counts from the first frame. */
  viewCount: number;
  /** Has live-streaming details: a live stream or a premiere. */
  isLive: boolean;
  categoryId: string | null;
  tags: string[];
  thumbnailUrl: string | null;
  /** The audio language if set, else the metadata language. */
  language: string | null;
  privacyStatus: string | null;
}

/** Pure parser for a `videos.list` response. */
export function parseVideos(body: unknown): VideoMetadata[] {
  return (youtubeVideoListSchema.parse(body).items ?? []).map((video) => {
    const { snippet } = video;
    const thumbnails = snippet.thumbnails;
    const thumbnail =
      thumbnails?.maxres ??
      thumbnails?.standard ??
      thumbnails?.high ??
      thumbnails?.medium ??
      thumbnails?.default;
    return {
      id: video.id,
      title: snippet.title,
      description: snippet.description ?? "",
      publishedAt: snippet.publishedAt,
      durationS: parseIsoDuration(video.contentDetails.duration),
      viewCount: Number(video.statistics?.viewCount ?? 0),
      isLive: video.liveStreamingDetails !== undefined,
      categoryId: snippet.categoryId ?? null,
      tags: snippet.tags ?? [],
      thumbnailUrl: thumbnail?.url ?? null,
      language: snippet.defaultAudioLanguage ?? snippet.defaultLanguage ?? null,
      privacyStatus: video.status?.privacyStatus ?? null,
    };
  });
}
