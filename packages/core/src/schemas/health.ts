import { z } from "zod";

/** `GET /api/healthz` response. */
export const healthzResponseSchema = z.object({
  status: z.literal("ok"),
  versions: z.object({
    extraction: z.string(),
    feature: z.string(),
    model: z.string(),
  }),
});
export type HealthzResponse = z.infer<typeof healthzResponseSchema>;
