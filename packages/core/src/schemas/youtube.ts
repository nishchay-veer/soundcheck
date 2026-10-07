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

const videoThumbnailsSchema = z.object({
  default: thumbnailSchema.optional(),
  medium: thumbnailSchema.optional(),
  high: thumbnailSchema.optional(),
  standard: thumbnailSchema.optional(),
  maxres: thumbnailSchema.optional(),
});

/** One `videos.list` item with `part=snippet,contentDetails,statistics,status,liveStreamingDetails`. */
export const youtubeVideoSchema = z.object({
  id: z.string().min(1),
  snippet: z.object({
    publishedAt: z.iso.datetime({ offset: true }),
    title: z.string(),
    description: z.string().optional(),
    thumbnails: videoThumbnailsSchema.optional(),
    tags: z.array(z.string()).optional(),
    categoryId: z.string().optional(),
    defaultLanguage: z.string().optional(),
    defaultAudioLanguage: z.string().optional(),
  }),
  contentDetails: z.object({ duration: z.string() }),
  /** Absent counts are hidden by the owner; the owner normally sees them all. */
  statistics: z.object({ viewCount: z.string().optional() }).optional(),
  status: z.object({ privacyStatus: z.string() }).optional(),
  /** Present for live streams and premieres, past or upcoming. */
  liveStreamingDetails: z.object({}).optional(),
});

/** `videos.list` response. Deleted videos are simply missing from `items`. */
export const youtubeVideoListSchema = z.object({
  items: z.array(youtubeVideoSchema).optional(),
});

/**
 * YouTube Analytics `reports.query` result table. Columns list the requested
 * dimensions, then the metrics, in request order; `rows` is omitted when the
 * query matches no data.
 */
export const analyticsReportSchema = z.object({
  columnHeaders: z.array(
    z.object({
      name: z.string().min(1),
      columnType: z.enum(["DIMENSION", "METRIC"]),
      dataType: z.string(),
    }),
  ),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).nullish(),
});
export type AnalyticsReport = z.infer<typeof analyticsReportSchema>;

/** A YouTube Reporting API job: YouTube generates its report type daily from creation on. */
export const reportingJobSchema = z.object({
  id: z.string().min(1),
  reportTypeId: z.string().min(1),
  name: z.string().optional(),
  createTime: z.iso.datetime({ offset: true }).optional(),
});

/** `jobs.list` response. `jobs` is omitted when the channel has none. */
export const reportingJobListSchema = z.object({
  jobs: z.array(reportingJobSchema).optional(),
  nextPageToken: z.string().optional(),
});
