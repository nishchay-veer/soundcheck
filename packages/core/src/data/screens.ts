import { NotFoundError } from "../errors";
import {
  channelIdSchema,
  servingPaths,
  summaryDocSchema,
  videoDocSchema,
  videoIdSchema,
  videoIndexDocSchema,
  type ChannelView,
  type SummaryDoc,
  type VideoDoc,
  type VideoIndexDoc,
} from "../schemas";
import { requireChannel } from "./authz";
import { readDocument } from "./store";
import { toChannelView } from "./users";

/**
 * The screens' data (Phase 11): each function checks that the user owns the
 * channel and returns one document the publish job wrote, parsed by its
 * schema. Server components call these directly; route handlers wrap them.
 *
 * The ownership check and the document read run together, so a screen costs
 * one round trip; another user's document is read but never returned.
 */

/** The channel as the browser sees it, with its build state and progress. */
export async function getChannel(userId: string, channelId: string): Promise<ChannelView> {
  return toChannelView(await requireChannel(userId, channelId));
}

/**
 * A document of a channel the user owns, read together with the ownership
 * check; undefined when it does not exist. A malformed channel ID never
 * reaches a read.
 */
async function readOwned(
  userId: string,
  channelId: string,
  path: (paths: ReturnType<typeof servingPaths>) => string,
): Promise<unknown> {
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  const [, data] = await Promise.all([
    requireChannel(userId, channelId),
    readDocument(path(servingPaths(channelId))),
  ]);
  return data;
}

/** The channel overview, or null until a build has published one. */
export async function getSummary(userId: string, channelId: string): Promise<SummaryDoc | null> {
  const data = await readOwned(userId, channelId, (paths) => paths.summary);
  return data === undefined ? null : summaryDocSchema.parse(data);
}

/** Every published video, or null until a build has published the list. */
export async function listVideos(userId: string, channelId: string): Promise<VideoIndexDoc | null> {
  const data = await readOwned(userId, channelId, (paths) => paths.videoIndex);
  return data === undefined ? null : videoIndexDocSchema.parse(data);
}

/** One video's screen; a malformed ID or an unpublished video is a NotFoundError (404). */
export async function getVideo(
  userId: string,
  channelId: string,
  videoId: string,
): Promise<VideoDoc> {
  if (!videoIdSchema.safeParse(videoId).success) {
    await requireChannel(userId, channelId);
    throw new NotFoundError("video");
  }
  const data = await readOwned(userId, channelId, (paths) => paths.video(videoId));
  if (data === undefined) throw new NotFoundError("video");
  return videoDocSchema.parse(data);
}
