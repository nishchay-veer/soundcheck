import { z } from "zod";
import { firestoreDate } from "./firestore";

/** A YouTube channel ID: "UC" followed by 22 URL-safe characters. */
export const channelIdSchema = z.string().regex(/^UC[\w-]{22}$/);

export const channelStatusSchema = z.enum(["connected", "reauth_required"]);
export type ChannelStatus = z.infer<typeof channelStatusSchema>;

/** Progress of the unattended channel build (wired to Workflows in Phase 10). */
export const buildStateSchema = z.enum(["not_started", "queued", "running", "succeeded", "failed"]);

/**
 * `channels/{channelId}`. The refresh token is stored only as KMS ciphertext
 * (base64), encrypted with the owner's `userId` as additional authenticated data.
 */
export const channelDocSchema = z.object({
  userId: z.string().min(1),
  title: z.string(),
  thumbnailUrl: z.url().nullable(),
  /** Null when the creator hides their subscriber count. */
  subscriberCount: z.number().int().nonnegative().nullable(),
  videoCount: z.number().int().nonnegative(),
  uploadsPlaylistId: z.string().min(1),
  status: channelStatusSchema,
  tokenCiphertext: z.string().min(1),
  tokenScope: z.string(),
  connectedAt: firestoreDate,
  build: z.object({ state: buildStateSchema }),
});
export type ChannelDoc = z.infer<typeof channelDocSchema>;

/** A channel document together with its ID. */
export type Channel = ChannelDoc & { id: string };
