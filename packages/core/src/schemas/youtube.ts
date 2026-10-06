import { z } from "zod";

/**
 * The parts of YouTube Data API v3 responses Soundcheck reads. Counts arrive
 * as strings. Unknown fields are ignored.
 */

const thumbnailSchema = z.object({ url: z.url() });

export const youtubeChannelSchema = z.object({
  id: z.string(),
  snippet: z.object({
    title: z.string(),
    thumbnails: z
      .object({
        default: thumbnailSchema.optional(),
        medium: thumbnailSchema.optional(),
        high: thumbnailSchema.optional(),
      })
      .optional(),
  }),
  statistics: z.object({
    subscriberCount: z.string().optional(),
    hiddenSubscriberCount: z.boolean().optional(),
    videoCount: z.string(),
  }),
  contentDetails: z.object({
    relatedPlaylists: z.object({ uploads: z.string() }),
  }),
});

/** `channels.list` response. */
export const youtubeChannelListSchema = z.object({
  items: z.array(youtubeChannelSchema).optional(),
});
export type YoutubeChannelList = z.infer<typeof youtubeChannelListSchema>;

export const youtubePlaylistItemSchema = z.object({
  snippet: z.object({ title: z.string() }),
  contentDetails: z.object({
    videoId: z.string(),
    /** Absent for private or deleted videos. */
    videoPublishedAt: z.iso.datetime({ offset: true }).optional(),
  }),
});

/** `playlistItems.list` response. */
export const youtubePlaylistItemListSchema = z.object({
  items: z.array(youtubePlaylistItemSchema).optional(),
  nextPageToken: z.string().optional(),
});
