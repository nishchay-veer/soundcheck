import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  HAZARD_MAX,
  hazards,
  monotoneSurvival,
  rewatchBumps,
  rewatchMass,
  survivalFromHazards,
  survivalLabels,
} from "./survival";

const close = (actual: number[], expected: number[]) => {
  expect(actual).toHaveLength(expected.length);
  actual.forEach((value, index) => expect(value).toBeCloseTo(expected[index] as number, 12));
};

describe("monotoneSurvival", () => {
  it("is the running minimum, so rewatch bumps disappear", () => {
    expect(monotoneSurvival([0.9, 0.8, 0.85, 0.7, 0.75])).toEqual([0.9, 0.8, 0.8, 0.7, 0.7]);
  });

  it("caps survival at 1: rewatching cannot add viewers", () => {
    expect(monotoneSurvival([1.45, 1.3, 0.95, 1.1])).toEqual([1, 1, 0.95, 0.95]);
  });
});

describe("hazards", () => {
  it("is the share of remaining viewers who leave in each bin", () => {
    close(hazards([0.8, 0.6, 0.6, 0.3]), [0.2, 0.25, 0, 0.5]);
  });

  it("clips a bin where everyone leaves, then stays 0 with nobody left", () => {
    expect(hazards([0.5, 0, 0])).toEqual([0.5, HAZARD_MAX, 0]);
  });
});

describe("hand-made curves", () => {
  it("a steady 10% loss per bin has a constant hazard of 0.1", () => {
    const watch = Array.from({ length: 100 }, (_, i) => 0.9 ** (i + 1));
    const { sMono, hazard, rewatchBumps: bumps, rewatchMass: mass } = survivalLabels(watch);
    close(sMono, watch);
    close(hazard, Array<number>(100).fill(0.1));
    expect(bumps).toBe(0);
    expect(mass).toBe(0);
  });

  it("a rewatch bump leaves hazards non-negative and is counted", () => {
    const watch = [0.9, 0.7, 0.75, 0.8, 0.6];
    const { sMono, hazard, rewatchBumps: bumps, rewatchMass: mass } = survivalLabels(watch);
    expect(sMono).toEqual([0.9, 0.7, 0.7, 0.7, 0.6]);
    expect(hazard.every((h) => h >= 0)).toBe(true);
    close(hazard, [0.1, 1 - 0.7 / 0.9, 0, 0, 1 - 0.6 / 0.7]);
    expect(bumps).toBe(2);
    expect(mass).toBeCloseTo(0.05 + 0.1, 12);
  });

  it("a looping Short above 1 has zero hazard until it drops below 1", () => {
    const { hazard, rewatchMass: mass } = survivalLabels([1.45, 1.2, 1.05, 0.9]);
    close(hazard, [0, 0, 0, 0.1]);
    expect(mass).toBeCloseTo(0.45 + 0.2 + 0.05, 12);
  });

  it("a rise of 0.02 or less is not a bump", () => {
    expect(rewatchBumps([0.5, 0.52, 0.51, 0.53])).toBe(0);
    expect(rewatchBumps([0.5, 0.5201])).toBe(1);
    expect(rewatchMass([0.5, 0.52], [0.5, 0.5])).toBeCloseTo(0.02, 12);
  });

  it("rejects negative or non-finite ratios", () => {
    expect(() => survivalLabels([0.9, -0.1])).toThrow(RangeError);
    expect(() => survivalLabels([0.9, Number.NaN])).toThrow(RangeError);
  });
});

describe("properties", () => {
  const anyCurve = fc.array(fc.double({ min: 0, max: 2, noNaN: true }), {
    minLength: 1,
    maxLength: 100,
  });

  it("rebuilding survival from hazards reproduces s_mono within 1e-9 (no clipping)", () => {
    // Clipping only applies when survival reaches 0, so keep every point above it.
    const unclipped = fc.array(fc.double({ min: 0.001, max: 2, noNaN: true }), {
      minLength: 1,
      maxLength: 100,
    });
    fc.assert(
      fc.property(unclipped, (watch) => {
        const { sMono, hazard } = survivalLabels(watch);
        survivalFromHazards(hazard).forEach((value, index) => {
          expect(Math.abs(value - (sMono[index] as number))).toBeLessThan(1e-9);
        });
      }),
    );
  });

  it("s_mono never rises and never exceeds 1; hazards stay in [0, 0.999]", () => {
    fc.assert(
      fc.property(anyCurve, (watch) => {
        const { sMono, hazard, rewatchMass: mass } = survivalLabels(watch);
        sMono.forEach((value, index) => {
          expect(value).toBeLessThanOrEqual(index === 0 ? 1 : (sMono[index - 1] as number));
        });
        for (const h of hazard) {
          expect(h).toBeGreaterThanOrEqual(0);
          expect(h).toBeLessThanOrEqual(HAZARD_MAX);
        }
        expect(mass).toBeGreaterThanOrEqual(0);
      }),
    );
  });
});
