import { z } from "zod";

/**
 * The feature spec: the ordered columns of every feature vector, written to
 * `feature_specs` so the Python fitter can name the columns of `x`
 * (Phase 07). The spec itself lives in `features/spec.ts`.
 */

/** The family a column belongs to. Phase 08 leaves `spline` columns unpenalized. */
export const featureKindSchema = z.enum([
  "beat_type",
  "picture",
  "audio",
  "delivery",
  "dynamics",
  "narrative",
  "position",
  "spline",
  "video",
  "mix",
  "interaction",
]);
export type FeatureKind = z.infer<typeof featureKindSchema>;

export const featureSpecEntrySchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  kind: featureKindSchema,
  /** Bounds the stored value is clipped to; null where the inputs are already bounded. */
  clip: z.tuple([z.number(), z.number()]).nullable(),
});
export type FeatureSpecEntry = z.infer<typeof featureSpecEntrySchema>;

export const featureSpecDocumentSchema = z.object({
  /** Bumped by hand when a feature's computation changes but its column does not. */
  revision: z.number().int().positive(),
  /** Numbers the features are computed with, such as the bin count and thresholds. */
  parameters: z.record(z.string(), z.number()),
  /** The cubic B-spline of elapsed ratio behind `pos_b*`. */
  position: z.object({
    degree: z.number().int().positive(),
    interior_knots: z.array(z.number().gt(0).lt(1)),
    /** The basis function left out because the model has an intercept. */
    dropped_basis: z.number().int().nonnegative(),
  }),
  /** Content features multiplied by each centered traffic share, on newcomer rows. */
  interactions: z.object({
    features: z.array(z.string().min(1)),
    mix: z.array(z.string().min(1)),
  }),
  features: z.array(featureSpecEntrySchema).min(1),
});
export type FeatureSpecDocument = z.infer<typeof featureSpecDocumentSchema>;
