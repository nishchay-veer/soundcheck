import { z } from "zod";
import { buildStateSchema, channelStatusSchema } from "./channels";

/** What the browser may see of a channel: never the token ciphertext or scopes. */
export const channelSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnailUrl: z.url().nullable(),
  subscriberCount: z.number().int().nonnegative().nullable(),
  videoCount: z.number().int().nonnegative(),
  status: channelStatusSchema,
  connectedAt: z.iso.datetime(),
  build: z.object({ state: buildStateSchema }),
});
export type ChannelSummary = z.infer<typeof channelSummarySchema>;

/** `GET /api/v1/me` response. */
export const meResponseSchema = z.object({
  user: z.object({ id: z.string(), email: z.email() }),
  channels: z.array(channelSummarySchema),
});
export type MeResponse = z.infer<typeof meResponseSchema>;
