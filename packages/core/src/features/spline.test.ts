import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { POSITION_KNOTS, POSITION_SPLINE } from "./spec";
import { bsplineBasis, clampedKnots } from "./spline";

interface SplineFixture {
  degree: number;
  knots: number[];
  x: number[];
  basis: number[][];
}

/** scipy's BSpline at 101 points, from services/modeling/scripts/spline_fixture.py. */
const fixture = JSON.parse(
  readFileSync(new URL("../../../../tests/fixtures/spline.json", import.meta.url), "utf8"),
) as SplineFixture;

const { degree } = POSITION_SPLINE;

describe("bsplineBasis", () => {
  it("was cross-checked on the position spline's knots", () => {
    expect(fixture.degree).toBe(degree);
    expect(fixture.knots).toEqual(POSITION_KNOTS);
    expect(fixture.x).toHaveLength(101);
  });

  it("matches scipy's BSpline within 1e-12 at every fixture point", () => {
    let worst = 0;
    fixture.x.forEach((x, i) => {
      const expected = fixture.basis[i] as number[];
      const actual = bsplineBasis(x, POSITION_KNOTS, degree);
      expect(actual).toHaveLength(expected.length);
      actual.forEach((value, j) => {
        worst = Math.max(worst, Math.abs(value - (expected[j] as number)));
      });
    });
    expect(worst).toBeLessThan(1e-12);
  });

  it("sums to 1 everywhere on [0, 1], with at most degree + 1 non-zero values", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (x) => {
        const basis = bsplineBasis(x, POSITION_KNOTS, degree);
        expect(Math.abs(basis.reduce((sum, value) => sum + value, 0) - 1)).toBeLessThan(1e-12);
        expect(basis.every((value) => value >= 0 && value <= 1)).toBe(true);
        expect(basis.filter((value) => value > 0).length).toBeLessThanOrEqual(degree + 1);
      }),
    );
  });

  it("is 1 for the first function at 0 and the last at 1 (clamped ends)", () => {
    expect(bsplineBasis(0, POSITION_KNOTS, degree)).toEqual([1, 0, 0, 0, 0, 0, 0]);
    expect(bsplineBasis(1, POSITION_KNOTS, degree)).toEqual([0, 0, 0, 0, 0, 0, 1]);
  });

  it("rejects points outside the knots", () => {
    for (const x of [-0.01, 1.01, Number.NaN]) {
      expect(() => bsplineBasis(x, POSITION_KNOTS, degree)).toThrow(RangeError);
    }
  });
});

describe("clampedKnots", () => {
  it("repeats each end degree + 1 times around the interior knots", () => {
    expect(clampedKnots([0.5], 2)).toEqual([0, 0, 0, 0.5, 1, 1, 1]);
  });

  it("rejects interior knots that are not strictly increasing inside (0, 1)", () => {
    expect(() => clampedKnots([0.5, 0.5], 3)).toThrow(RangeError);
    expect(() => clampedKnots([0, 0.5], 3)).toThrow(RangeError);
    expect(() => clampedKnots([0.5], -1)).toThrow(RangeError);
  });
});
