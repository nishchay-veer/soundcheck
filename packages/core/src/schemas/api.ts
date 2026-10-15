import { z } from "zod";
import { buildStateSchema, channelStatusSchema, runIdSchema } from "./channels";

/**
 * What the browser may see of a channel's build: `channels/{id}.build` with
 * dates as ISO strings, without the Workflows execution path.
 */
export const buildViewSchema = z.object({
  state: buildStateSchema,
  runId: runIdSchema.optional(),
  mode: z.enum(["build", "refresh"]).optional(),
  stage: z.string().min(1).optional(),
  stageStartedAt: z.iso.datetime().optional(),
  stageAttempt: z.number().int().min(1).optional(),
  startedAt: z.iso.datetime().optional(),
  finishedAt: z.iso.datetime().optional(),
  error: z.string().optional(),
  eligibleVideos: z.number().int().nonnegative().optional(),
  usableVideos: z.number().int().nonnegative().optional(),
  progress: z
    .object({
      stage: z.string().min(1),
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      etaS: z.number().nonnegative().optional(),
      updatedAt: z.iso.datetime(),
    })
    .optional(),
});
export type BuildView = z.infer<typeof buildViewSchema>;

/**
 * What the browser may see of a channel: never the token ciphertext or scopes.
 * `GET /api/v1/channels/{id}` returns one; `GET /api/v1/me` lists them.
 */
export const channelViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnailUrl: z.url().nullable(),
  subscriberCount: z.number().int().nonnegative().nullable(),
  videoCount: z.number().int().nonnegative(),
  status: channelStatusSchema,
  connectedAt: z.iso.datetime(),
  build: buildViewSchema,
});
export type ChannelView = z.infer<typeof channelViewSchema>;

/** `GET /api/v1/me` response. */
export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.email() }),
  channels: z.array(channelViewSchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `DELETE /api/v1/channels/{id}` response: what was removed, for the user and the logs. */
export const channelDeletionSchema = z.object({
  channelId: z.string(),
  /** False when Google already considered the token invalid. */
  tokenRevoked: z.boolean(),
  bigqueryRowsDeleted: z.record(z.string(), z.number().int().nonnegative()),
  storageObjectsDeleted: z.record(z.string(), z.number().int().nonnegative()),
});
export type ChannelDeletion = z.infer<typeof channelDeletionSchema>;

/** `POST /api/v1/channels/{id}/build`: the build that was started. */
export const buildStartSchema = z.object({
  channelId: z.string().min(1),
  runId: runIdSchema,
  mode: z.enum(["build", "refresh"]),
  state: z.literal("queued"),
});
export type BuildStart = z.infer<typeof buildStartSchema>;
