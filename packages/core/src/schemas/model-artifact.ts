import { z } from "zod";
import { trainingAudienceSchema } from "./bigquery";
import { channelIdSchema } from "./channels";

/**
 * The model artifact: one fitted hazard model for one audience, written by the
 * Python fitter and read by the TypeScript runtime (Phase 08). Python
 * validates it against the JSON Schema `gen:schemas` exports from this.
 *
 * For video v, audience a and bin b: logit h = alpha + beta . (x - mean) / sd,
 * where x holds the columns `featureNames` of the Phase 07 feature vector.
 * `cov` is the Laplace covariance scaled by the quasi-likelihood dispersion.
 */

const share = z.number().min(0).max(1);

/** What the features were measured against when the model was trained; predictions reuse it. */
export const channelContextSchema = z.object({
  medianTargetLevel: z.number().min(1).max(5),
  mixMean: z.object({ search: share, suggested: share, browse: share }),
});

export const modelMetricsSchema = z.object({
  rows: z.number().int().nonnegative(),
  videos: z.number().int().nonnegative(),
  /** Weighted mean negative log-likelihood on the training rows. */
  trainLoss: z.number(),
  /** Held-out loss for each penalty tried; null when there were too few videos to cross-validate. */
  cv: z.array(z.object({ lambda: z.number().nonnegative(), loss: z.number().nullable() })),
  folds: z.number().int().nonnegative(),
  iterations: z.number().int().nonnegative(),
  converged: z.boolean(),
  gradientNorm: z.number().nonnegative(),
  /** The quasi-likelihood dispersion the covariance is scaled by. */
  dispersion: z.number().positive(),
  /** The effective number of parameters, below the column count when penalized. */
  effectiveParameters: z.number().nonnegative(),
});

export const modelArtifactSchema = z
  .object({
    runId: z.string().regex(/^[\w-]+$/),
    /** Null for the pooled model, fitted across channels. */
    channelId: channelIdSchema.nullable(),
    audience: trainingAudienceSchema,
    modelVersion: z.string().min(1),
    featureVersion: z.string().min(1),
    extractionVersion: z.string().min(1),
    createdAt: z.iso.datetime({ offset: true }),
    /** The columns of `x` the model uses, in coefficient order. */
    featureNames: z.array(z.string().min(1)).min(1),
    /** Configured columns left out because they never vary in the training rows. */
    droppedFeatures: z.array(z.string().min(1)),
    /** Columns whose coefficients the penalty leaves alone. */
    unpenalized: z.array(z.string().min(1)),
    mean: z.array(z.number()),
    sd: z.array(z.number().positive()),
    alpha: z.number(),
    beta: z.array(z.number()),
    /** Laplace covariance of (alpha, beta), intercept first. */
    cov: z.array(z.array(z.number())),
    lambda: z.number().nonnegative(),
    /** The pooled model whose coefficients were the prior; null when the prior was 0. */
    priorRef: z.string().min(1).nullable(),
    trainChannelIds: z.array(channelIdSchema).min(1),
    trainVideoIds: z.array(z.string().min(1)).min(1),
    /** Null for the pooled model. */
    channelContext: channelContextSchema.nullable(),
    /** False when the model must not be shown or shipped; `unusableReasons` says why. */
    usable: z.boolean(),
    unusableReasons: z.array(z.string().min(1)),
    metrics: modelMetricsSchema,
  })
  .superRefine((artifact, context) => {
    const p = artifact.featureNames.length;
    const issue = (message: string) => context.addIssue({ code: "custom", message });
    for (const key of ["mean", "sd", "beta"] as const) {
      if (artifact[key].length !== p) issue(`${key} has ${artifact[key].length} values, not ${p}`);
    }
    if (artifact.cov.length !== p + 1 || artifact.cov.some((row) => row.length !== p + 1)) {
      issue(`cov must be ${p + 1} by ${p + 1}`);
    }
    if (new Set(artifact.featureNames).size !== p) issue("featureNames repeat a column");
    const unknown = artifact.unpenalized.filter((name) => !artifact.featureNames.includes(name));
    if (unknown.length > 0) issue(`unpenalized columns not in the model: ${unknown.join(", ")}`);
    if (artifact.usable === artifact.unusableReasons.length > 0) {
      issue("a usable model has no unusable reasons, and an unusable one has at least one");
    }
    if ((artifact.channelId === null) !== (artifact.channelContext === null)) {
      issue("the pooled model, and only it, has no channel context");
    }
  });
export type ModelArtifact = z.infer<typeof modelArtifactSchema>;
