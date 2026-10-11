import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeatureFrame } from "../features";
import type { ModelArtifact } from "../schemas";
import { createRandom, xoshiro128ss } from "./random";
import { drawCoefficients, loadArtifact, predictHazard, sampleCurves, survival } from "./runtime";

const parity = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/parity/${name}`, import.meta.url), "utf8"),
  );

/** The frame the TypeScript featurizer wrote and Python predicted for. */
function parityFrame(): FeatureFrame {
  const raw = parity("frame.json") as { rows: number; columns: string[]; values: number[] };
  return { rows: raw.rows, columns: raw.columns, values: Float64Array.from(raw.values) };
}

describe("cross-language parity", () => {
  const artifact = loadArtifact(parity("artifact.json"));
  const expected = parity("expected.json") as { hazards: number[]; survival: number[] };

  it("predicts the hazards Python's fitter predicts, within 1e-9", () => {
    const hazards = predictHazard(artifact, parityFrame());
    expect(hazards).toHaveLength(100);
    const worst = Math.max(...hazards.map((h, i) => Math.abs(h - (expected.hazards[i] as number))));
    expect(worst).toBeLessThan(1e-9);
  });

  it("turns them into the same survival curve", () => {
    const curve = survival(predictHazard(artifact, parityFrame()));
    const worst = Math.max(...curve.map((s, i) => Math.abs(s - (expected.survival[i] as number))));
    expect(worst).toBeLessThan(1e-9);
  });

  it("uses all 49 newcomer columns, mix and interactions included", () => {
    expect(artifact.featureNames).toHaveLength(49);
    expect(artifact.featureNames).toContain("ix_beat_sponsor_search");
  });
});

/** A model with three coefficients and a known covariance. */
const small: ModelArtifact = {
  ...loadArtifact(parity("artifact.json")),
  featureNames: ["pos_b1", "energy"],
  droppedFeatures: [],
  unpenalized: ["pos_b1"],
  mean: [0.3, 3],
  sd: [0.2, 1],
  alpha: -3,
  beta: [0.4, -0.2],
  cov: [
    [0.04, 0.012, -0.006],
    [0.012, 0.09, 0.018],
    [-0.006, 0.018, 0.0225],
  ],
};

describe("drawCoefficients", () => {
  it("reproduces the covariance over 20,000 draws", () => {
    const draws = drawCoefficients(small, 20_000, 7);
    const size = 3;
    const mean = Array.from(
      { length: size },
      (_, i) => draws.reduce((s, d) => s + (d[i] as number), 0) / draws.length,
    );
    expect(mean[0]).toBeCloseTo(-3, 2);
    for (let i = 0; i < size; i += 1) {
      for (let j = 0; j < size; j += 1) {
        const covariance =
          draws.reduce(
            (s, d) =>
              s +
              ((d[i] as number) - (mean[i] as number)) * ((d[j] as number) - (mean[j] as number)),
            0,
          ) /
          (draws.length - 1);
        const truth = (small.cov[i] as number[])[j] as number;
        // About four standard errors of a sample covariance at n = 20,000.
        const sii = (small.cov[i] as number[])[i] as number;
        const sjj = (small.cov[j] as number[])[j] as number;
        const tolerance = 4 * Math.sqrt((sii * sjj + truth * truth) / draws.length);
        expect(Math.abs(covariance - truth), `cov[${i}][${j}]`).toBeLessThan(tolerance);
      }
    }
  });

  it("is deterministic for a seed and refuses a covariance that is not positive definite", () => {
    expect(drawCoefficients(small, 5, 42)).toEqual(drawCoefficients(small, 5, 42));
    expect(drawCoefficients(small, 5, 42)).not.toEqual(drawCoefficients(small, 5, 43));
    const broken = {
      ...small,
      cov: [
        [1, 2, 0],
        [2, 1, 0],
        [0, 0, 1],
      ],
    };
    expect(() => drawCoefficients(broken, 5, 1)).toThrow(/not positive definite/);
    expect(() => drawCoefficients(small, 0, 1)).toThrow(RangeError);
  });

  it("widens every draw by the square root of an inflation factor", () => {
    const estimate = [small.alpha, ...small.beta];
    const plain = drawCoefficients(small, 5, 42);
    const inflated = drawCoefficients(small, 5, 42, 4);
    inflated.forEach((draw, d) =>
      draw.forEach((value, i) => {
        const shift = ((plain[d] as Float64Array)[i] as number) - (estimate[i] as number);
        expect(value - (estimate[i] as number)).toBeCloseTo(2 * shift, 12);
      }),
    );
    expect(drawCoefficients(small, 5, 42, 1)).toEqual(plain);
    for (const factor of [0, -1, Number.NaN]) {
      expect(() => drawCoefficients(small, 5, 42, factor)).toThrow(/must be positive/);
    }
  });
});

describe("sampleCurves", () => {
  const artifact = loadArtifact(parity("artifact.json"));

  const scaled = (factor: number) => ({
    ...artifact,
    cov: artifact.cov.map((row) => row.map((value) => value * factor)),
  });

  it("gives ordered, falling percentile curves, the same for a seed", () => {
    const frame = parityFrame();
    const band = sampleCurves(artifact, frame, 200, 11);
    for (let bin = 0; bin < 100; bin += 1) {
      expect(band.p10[bin]).toBeLessThanOrEqual(band.p50[bin] as number);
      expect(band.p50[bin]).toBeLessThanOrEqual(band.p90[bin] as number);
      if (bin > 0) expect(band.p50[bin]).toBeLessThanOrEqual(band.p50[bin - 1] as number);
    }
    expect(sampleCurves(artifact, frame, 200, 11)).toEqual(band);
    expect(sampleCurves(artifact, frame, 200, 12).p10).not.toEqual(band.p10);
  });

  it("collapses onto the estimate as the uncertainty vanishes, and holds it inside the band", () => {
    const frame = parityFrame();
    const estimate = survival(predictHazard(artifact, frame));
    const certain = sampleCurves(scaled(1e-6), frame, 200, 11);
    const moderate = sampleCurves(scaled(0.01), frame, 200, 11);
    for (let bin = 0; bin < 100; bin += 1) {
      const value = estimate[bin] as number;
      expect(Math.abs((certain.p50[bin] as number) - value)).toBeLessThan(1e-3);
      expect((certain.p90[bin] as number) - (certain.p10[bin] as number)).toBeLessThan(1e-3);
      expect(moderate.p10[bin]).toBeLessThanOrEqual(value);
      expect(moderate.p90[bin]).toBeGreaterThanOrEqual(value);
    }
  });

  it("widens the band with an inflation factor", () => {
    const frame = parityFrame();
    const plain = sampleCurves(artifact, frame, 200, 11);
    const wide = sampleCurves(artifact, frame, 200, 11, 9);
    for (let bin = 0; bin < 100; bin += 1) {
      expect(wide.p10[bin]).toBeLessThanOrEqual(plain.p10[bin] as number);
      expect(wide.p90[bin]).toBeGreaterThanOrEqual(plain.p90[bin] as number);
    }
  });

  it("needs every column the model uses in the frame", () => {
    const frame = parityFrame();
    const missing = { ...frame, columns: frame.columns.map((c) => (c === "energy" ? "other" : c)) };
    expect(() => predictHazard(artifact, missing)).toThrow(/Unknown feature: energy/);
  });
});

describe("survival", () => {
  it("is the running product of 1 - hazard", () => {
    expect(Array.from(survival([0.5, 0.2, 0]))).toEqual([0.5, 0.4, 0.4]);
  });
});

describe("random", () => {
  it("matches xoshiro128**'s reference outputs for the state 1, 2, 3, 4", () => {
    const random = xoshiro128ss([1, 2, 3, 4]);
    expect([random.nextUint32(), random.nextUint32(), random.nextUint32()]).toEqual([
      11520, 0, 5927040,
    ]);
    expect(() => xoshiro128ss([0, 0, 0, 0])).toThrow(RangeError);
  });

  it("draws standard normals and uniforms strictly inside (0, 1)", () => {
    const random = createRandom(2026);
    const normals = Array.from({ length: 50_000 }, () => random.normal());
    const mean = normals.reduce((s, v) => s + v, 0) / normals.length;
    const variance = normals.reduce((s, v) => s + (v - mean) ** 2, 0) / normals.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.abs(variance - 1)).toBeLessThan(0.03);
    const uniforms = Array.from({ length: 10_000 }, () => random.uniform());
    expect(uniforms.every((u) => u > 0 && u < 1)).toBe(true);
    expect(createRandom(5).uniform()).toBe(createRandom(5).uniform());
  });
});
