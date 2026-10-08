import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  bothLabelled,
  boundaryF1,
  cohenKappa,
  confusionMatrix,
  internalBoundaries,
  meanAbsoluteDifference,
  perSecond,
  quadraticWeightedKappa,
  spearman,
} from "./agreement";

/** Two raters' yes/no answers from a 2x2 table [[yes-yes, yes-no], [no-yes, no-no]]. */
function fromTable([[yy, yn], [ny, nn]]: [[number, number], [number, number]]): [
  string[],
  string[],
] {
  const a: string[] = [];
  const b: string[] = [];
  const add = (count: number, x: string, y: string) => {
    for (let i = 0; i < count; i += 1) {
      a.push(x);
      b.push(y);
    }
  };
  add(yy, "yes", "yes");
  add(yn, "yes", "no");
  add(ny, "no", "yes");
  add(nn, "no", "no");
  return [a, b];
}

describe("cohenKappa", () => {
  // Wikipedia, "Cohen's kappa": the worked example and the two "same percentage,
  // different numbers" tables (all with 60% or 70% observed agreement).
  it.each([
    [
      [
        [20, 5],
        [10, 15],
      ],
      0.4,
    ],
    [
      [
        [45, 15],
        [25, 15],
      ],
      0.1304,
    ],
    [
      [
        [25, 35],
        [5, 35],
      ],
      0.2593,
    ],
  ] as const)("matches the published value for %j", (table, expected) => {
    const [a, b] = fromTable(table as unknown as [[number, number], [number, number]]);
    expect(cohenKappa(a, b)).toBeCloseTo(expected, 4);
  });

  it("is 1 for identical labels and undefined (null) for one shared label throughout", () => {
    expect(cohenKappa(["hook", "setup", "outro"], ["hook", "setup", "outro"])).toBe(1);
    expect(cohenKappa(["performance", "performance"], ["performance", "performance"])).toBeNull();
  });

  it("rejects sequences of different lengths or no items", () => {
    expect(() => cohenKappa(["a"], ["a", "b"])).toThrow(RangeError);
    expect(() => cohenKappa([], [])).toThrow(RangeError);
  });

  it("is symmetric and never above 1", () => {
    const labels = fc.array(
      fc.tuple(fc.constantFrom("a", "b", "c"), fc.constantFrom("a", "b", "c")),
      {
        minLength: 1,
        maxLength: 60,
      },
    );
    fc.assert(
      fc.property(labels, (pairs) => {
        const a = pairs.map(([x]) => x);
        const b = pairs.map(([, y]) => y);
        const ab = cohenKappa(a, b);
        const ba = cohenKappa(b, a);
        if (ab === null) {
          expect(ba).toBeNull();
        } else {
          expect(ab).toBeCloseTo(ba as number, 12);
          expect(ab).toBeLessThanOrEqual(1 + 1e-12);
        }
      }),
    );
  });
});

describe("quadraticWeightedKappa", () => {
  const scale = { min: 1, max: 5 };

  /** Lin's concordance correlation with population moments. */
  function concordance(x: number[], y: number[]): number {
    const n = x.length;
    const mx = x.reduce((s, v) => s + v, 0) / n;
    const my = y.reduce((s, v) => s + v, 0) / n;
    const vx = x.reduce((s, v) => s + (v - mx) ** 2, 0) / n;
    const vy = y.reduce((s, v) => s + (v - my) ** 2, 0) / n;
    const cov = x.reduce((s, v, i) => s + (v - mx) * ((y[i] as number) - my), 0) / n;
    return (2 * cov) / (vx + vy + (mx - my) ** 2);
  }

  it("equals Lin's concordance correlation, a known identity for quadratic weights", () => {
    expect(quadraticWeightedKappa([1, 2, 3, 4, 5, 3, 2], [1, 3, 3, 5, 4, 2, 2], scale)).toBeCloseTo(
      0.8158,
      4,
    );
    const ratings = fc.array(
      fc.tuple(fc.integer({ min: 1, max: 5 }), fc.integer({ min: 1, max: 5 })),
      {
        minLength: 2,
        maxLength: 50,
      },
    );
    fc.assert(
      fc.property(ratings, (pairs) => {
        const x = pairs.map(([a]) => a);
        const y = pairs.map(([, b]) => b);
        const kappa = quadraticWeightedKappa(x, y, scale);
        if (kappa === null) return;
        expect(kappa).toBeCloseTo(concordance(x, y), 9);
      }),
    );
  });

  it("equals Cohen's kappa with two categories", () => {
    const a = [1, 1, 2, 2, 1, 2, 1, 1];
    const b = [1, 2, 2, 2, 1, 1, 1, 2];
    expect(quadraticWeightedKappa(a, b, { min: 1, max: 2 })).toBeCloseTo(cohenKappa(a, b) ?? 0, 12);
  });

  it("is 1 when identical and -1 for a full reversal", () => {
    expect(quadraticWeightedKappa([1, 3, 5], [1, 3, 5], scale)).toBe(1);
    expect(quadraticWeightedKappa([1, 2, 3, 4, 5], [5, 4, 3, 2, 1], scale)).toBeCloseTo(-1, 12);
  });

  it("treats near misses as better than far ones", () => {
    const near = quadraticWeightedKappa([1, 2, 3, 4, 5], [2, 2, 3, 4, 4], scale) ?? 0;
    const far = quadraticWeightedKappa([1, 2, 3, 4, 5], [5, 2, 3, 4, 1], scale) ?? 0;
    expect(near).toBeGreaterThan(far);
  });

  it("is undefined (null) when both rate everything the same, and rejects off-scale ratings", () => {
    expect(quadraticWeightedKappa([3, 3], [3, 3], scale)).toBeNull();
    expect(() => quadraticWeightedKappa([0], [1], scale)).toThrow(RangeError);
  });
});

describe("boundaryF1", () => {
  it("matches boundaries within the tolerance, each at most once", () => {
    expect(boundaryF1([10, 20, 30], [11, 24, 30, 40], 3)).toEqual({
      f1: 4 / 7,
      matched: 2,
      first: 3,
      second: 4,
    });
    expect(boundaryF1([10, 11], [10.5], 3).matched).toBe(1);
  });

  it("is 1 for identical sets, including two empty ones, and 0 with nothing matched", () => {
    expect(boundaryF1([5, 60], [60, 5], 3).f1).toBe(1);
    expect(boundaryF1([], [], 3).f1).toBe(1);
    expect(boundaryF1([10], [], 3).f1).toBe(0);
  });

  it("finds the largest matching, whatever the order", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 300 }), { maxLength: 20 }), (times) => {
        expect(boundaryF1(times, [...times].reverse(), 3).f1).toBe(1);
      }),
    );
  });
});

describe("spearman", () => {
  it("matches Wikipedia's IQ and hours of TV example: -29/165", () => {
    const iq = [106, 100, 86, 101, 99, 103, 97, 113, 112, 110];
    const tv = [7, 27, 2, 50, 28, 29, 20, 12, 6, 17];
    expect(spearman(iq, tv)).toBeCloseTo(-29 / 165, 12);
  });

  it("averages tied ranks and is null for a constant side", () => {
    expect(spearman([1, 2, 2, 3], [1, 2, 2, 3])).toBeCloseTo(1, 12);
    expect(spearman([1, 1, 1], [1, 2, 3])).toBeNull();
  });
});

describe("meanAbsoluteDifference", () => {
  it("averages pairs with both values and counts one-sided ones", () => {
    expect(
      meanAbsoluteDifference([
        [31, 33],
        [10, 4],
        [null, null],
        [null, 12],
      ]),
    ).toEqual({ mean: 4, compared: 2, oneMissing: 1 });
    expect(meanAbsoluteDifference([[null, null]]).mean).toBeNull();
  });
});

describe("per-second sequences", () => {
  const spans = [
    { start_s: 0, end_s: 2.5, type: "hook" },
    { start_s: 2.5, end_s: 5, type: "setup" },
    { start_s: 7, end_s: 9, type: "outro" },
  ];

  it("labels each whole second by the span covering its middle; gaps are null", () => {
    expect(perSecond(spans, 9, (span) => span.type)).toEqual([
      "hook",
      "hook",
      "setup",
      "setup",
      "setup",
      null,
      null,
      "outro",
      "outro",
    ]);
  });

  it("keeps only seconds both sequences label", () => {
    expect(bothLabelled(["a", null, "b", "c"], ["a", "b", null, "d"])).toEqual([
      ["a", "c"],
      ["a", "d"],
    ]);
  });

  it("lists internal boundaries in time order", () => {
    expect(internalBoundaries([spans[2]!, spans[0]!, spans[1]!])).toEqual([2.5, 7]);
  });

  it("counts label pairs in a confusion matrix", () => {
    const matrix = confusionMatrix(["hook", "hook", "setup"], ["hook", "setup", "setup"]);
    expect(Object.fromEntries([...matrix].map(([k, row]) => [k, Object.fromEntries(row)]))).toEqual(
      {
        hook: { hook: 1, setup: 1 },
        setup: { setup: 1 },
      },
    );
  });
});
