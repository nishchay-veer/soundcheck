import { z } from "zod";

/** What Soundcheck adds to the Auth.js JWT: identifiers only, never tokens. */
export const sessionClaimsSchema = z.object({
  userId: z.string().min(1),
  channelIds: z.array(z.string()),
});
