import { CholeskyDecomposition, Matrix } from "ml-matrix";
import { frameColumn, type FeatureFrame } from "../features/timeline";
import { modelArtifactSchema, type ModelArtifact } from "../schemas";
import { createRandom } from "./random";

/**
 * The prediction runtime (Phase 08): hazards, survival and uncertainty bands
 * from a model artifact and a Phase 07 feature frame. The model is linear in
 * the features, logit h = alpha + beta . (x - mean) / sd, so this is a few
 * matrix products, fast enough to run inside a request.
 */

/** A validated artifact from its JSON. */
export function loadArtifact(value: unknown): ModelArtifact {
  return modelArtifactSchema.parse(value);
}

/** The frame's columns the model uses, standardized: one row per bin. */
function standardized(
  artifact: Pick<ModelArtifact, "featureNames" | "mean" | "sd">,
  frame: FeatureFrame,
): Float64Array[] {
  const columns = artifact.featureNames.map((name, j) => {
    const values = frameColumn(frame, name);
    const mean = artifact.mean[j] as number;
    const sd = artifact.sd[j] as number;
    return values.map((value) => (value - mean) / sd);
  });
  return Array.from({ length: frame.rows }, (_, bin) =>
    Float64Array.from(columns, (column) => column[bin] as number),
  );
}

const logistic = (eta: number) => 1 / (1 + Math.exp(-eta));

/** Hazards for coefficients theta = (alpha, beta...) on standardized rows. */
function hazardsFor(theta: ArrayLike<number>, rows: readonly Float64Array[]): Float64Array {
  return Float64Array.from(rows, (z) => {
    let eta = theta[0] as number;
    for (let j = 0; j < z.length; j += 1) eta += (theta[j + 1] as number) * (z[j] as number);
    return logistic(eta);
  });
}

/** The predicted hazard of each bin. */
export function predictHazard(artifact: ModelArtifact, frame: FeatureFrame): Float64Array {
  return hazardsFor([artifact.alpha, ...artifact.beta], standardized(artifact, frame));
}

/**
 * Each feature's part of each bin's logit, beta_j (x_j - mean_j) / sd_j: one
 * row per bin, in `featureNames` order. Alpha plus a row's sum is the bin's
 * logit, so the difference between two bins' rows says which features moved
 * the hazard (Phase 11's drop-off attribution).
 */
export function logitTerms(
  artifact: Pick<ModelArtifact, "featureNames" | "mean" | "sd" | "beta">,
  frame: FeatureFrame,
): Float64Array[] {
  return standardized(artifact, frame).map((z) =>
    z.map((value, j) => (artifact.beta[j] as number) * value),
  );
}

/** Share still watching at the end of each bin: the running product of 1 - hazard. */
export function survival(hazard: ArrayLike<number>): Float64Array {
  let still = 1;
  return Float64Array.from(hazard, (h) => (still *= 1 - h));
}

/**
 * `n` coefficient vectors (alpha, beta...) drawn from the model's normal
 * approximation: the estimate plus L z, with L the Cholesky factor of the
 * covariance and z standard normals. The same seed gives the same draws.
 *
 * `inflation` multiplies the covariance (each shift grows by its square
 * root): Phase 09's calibration factor, applied as the evaluation's
 * `sampled_curves` does in Python.
 */
export function drawCoefficients(
  artifact: ModelArtifact,
  n: number,
  seed: number,
  inflation = 1,
): Float64Array[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError(`Need at least one draw, got ${n}`);
  if (!Number.isFinite(inflation) || inflation <= 0) {
    throw new RangeError(`The inflation factor must be positive, got ${inflation}`);
  }
  const scale = Math.sqrt(inflation);
  const cholesky = new CholeskyDecomposition(new Matrix(artifact.cov));
  if (!cholesky.isPositiveDefinite()) {
    throw new RangeError(`The covariance of model ${artifact.runId} is not positive definite`);
  }
  const lower = cholesky.lowerTriangularMatrix.to2DArray();
  const estimate = [artifact.alpha, ...artifact.beta];
  const size = estimate.length;
  const random = createRandom(seed);
  return Array.from({ length: n }, () => {
    const z = Array.from({ length: size }, () => random.normal());
    return Float64Array.from(estimate, (value, i) => {
      const row = lower[i] as number[];
      let shift = 0;
      for (let k = 0; k <= i; k += 1) shift += (row[k] as number) * (z[k] as number);
      return value + scale * shift;
    });
  });
}

/** The q-quantile of sorted values, interpolating linearly between neighbours. */
function quantile(sorted: Float64Array, q: number): number {
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const above = Math.min(below + 1, sorted.length - 1);
  const low = sorted[below] as number;
  return low + (position - below) * ((sorted[above] as number) - low);
}

export interface SurvivalBand {
  /** Per bin, share still watching at its end, across sampled models. */
  p10: Float64Array;
  p50: Float64Array;
  p90: Float64Array;
}

/**
 * The 10th, 50th and 90th percentile survival curves over `n` coefficient
 * draws: the uncertainty band every prediction ships with. `inflation` widens
 * it by a held-out evaluation's calibration factor (see drawCoefficients).
 */
export function sampleCurves(
  artifact: ModelArtifact,
  frame: FeatureFrame,
  n = 200,
  seed = 1,
  inflation = 1,
): SurvivalBand {
  return survivalBand(sampleSurvival(artifact, frame, n, seed, inflation));
}

/**
 * The survival curve of each of `n` coefficient draws, for numbers a band
 * cannot give, such as the spread of each draw's average view percentage.
 * The same arguments give the same curves as `sampleCurves` summarizes.
 */
export function sampleSurvival(
  artifact: ModelArtifact,
  frame: FeatureFrame,
  n = 200,
  seed = 1,
  inflation = 1,
): Float64Array[] {
  const rows = standardized(artifact, frame);
  return drawCoefficients(artifact, n, seed, inflation).map((theta) =>
    survival(hazardsFor(theta, rows)),
  );
}

/** The 10th, 50th and 90th percentiles of sampled curves, bin by bin. */
export function survivalBand(curves: readonly Float64Array[]): SurvivalBand {
  const bins = curves[0]?.length ?? 0;
  const band = (q: number) =>
    Float64Array.from({ length: bins }, (_, bin) =>
      quantile(Float64Array.from(curves, (curve) => curve[bin] as number).sort(), q),
    );
  return { p10: band(0.1), p50: band(0.5), p90: band(0.9) };
}

/** The 10th, 50th and 90th percentiles of sampled numbers. */
export function percentiles(values: ArrayLike<number>): { p10: number; p50: number; p90: number } {
  const sorted = Float64Array.from(values).sort();
  return { p10: quantile(sorted, 0.1), p50: quantile(sorted, 0.5), p90: quantile(sorted, 0.9) };
}
