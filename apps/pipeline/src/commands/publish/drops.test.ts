import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { binLosses, findDrops } from "./drops";

/** A survival curve from the percentage points lost in each bin (index 0 is bin 1). */
function curveFrom(losses: readonly number[]): number[] {
  let still = 1;
  return losses.map((loss) => (still -= loss / 100));
}

/** Bin 1 loses 10 points, every other bin `base`, except the bins given. */
function lossesWith(spikes: Record<number, number>, base = 0.3): number[] {
  return Array.from({ length: 100 }, (_, i) => (i === 0 ? 10 : (spikes[i + 1] ?? base)));
}

describe("findDrops", () => {
  it("reports a one-bin spike as exactly that bin", () => {
    const drops = findDrops(curveFrom(lossesWith({ 40: 4.3 })), 200);
    expect(drops).toHaveLength(1);
    const [drop] = drops;
    expect(drop).toMatchObject({ binStart: 40, binEnd: 40, startS: 78, endS: 80 });
    expect(drop?.actualLossPp).toBeCloseTo(4.3, 10);
  });

  it("ignores the first bin and curves that never lose 1.5 points in three bins", () => {
    expect(findDrops(curveFrom(lossesWith({}, 0.4)), 200)).toEqual([]);
  });

  it("reports a steep stretch as one drop-off", () => {
    const drops = findDrops(curveFrom(lossesWith({ 60: 2, 61: 2, 62: 2, 63: 2, 64: 2 })), 100);
    expect(drops).toHaveLength(1);
    expect(drops[0]).toMatchObject({ binStart: 60, binEnd: 64, startS: 59, endS: 64 });
    expect(drops[0]?.actualLossPp).toBeCloseTo(10, 10);
  });

  it("keeps the four largest drop-offs, in time order", () => {
    // Five two-bin drops; the smallest (bins 10 and 11) is left out.
    const pairs = { 10: 2, 30: 2.5, 50: 3, 70: 3.5, 90: 3.2 };
    const spikes = Object.fromEntries(
      Object.entries(pairs).flatMap(([bin, loss]) => [
        [Number(bin), loss],
        [Number(bin) + 1, loss],
      ]),
    );
    const drops = findDrops(curveFrom(lossesWith(spikes)), 100);
    expect(drops.map((drop) => [drop.binStart, drop.binEnd])).toEqual([
      [30, 31],
      [50, 51],
      [70, 71],
      [90, 91],
    ]);
    expect(drops.map((drop) => Number(drop.actualLossPp.toFixed(6)))).toEqual([5, 6, 7, 6.4]);
  });

  it("finds separate, ordered drop-offs within the video on any falling curve", () => {
    const curve = fc
      .array(fc.double({ min: 0, max: 0.05, noNaN: true }), { minLength: 100, maxLength: 100 })
      .map((steps) => {
        let still = 1;
        return steps.map((step) => (still *= 1 - step));
      });
    fc.assert(
      fc.property(curve, fc.double({ min: 30, max: 7200, noNaN: true }), (shares, durationS) => {
        const drops = findDrops(shares, durationS);
        expect(drops.length).toBeLessThanOrEqual(4);
        drops.forEach((drop, k) => {
          expect(drop.binStart).toBeGreaterThanOrEqual(2);
          expect(drop.binEnd).toBeGreaterThanOrEqual(drop.binStart);
          expect(drop.binEnd).toBeLessThanOrEqual(100);
          expect(drop.actualLossPp).toBeGreaterThan(0);
          expect(drop.endS).toBeGreaterThan(drop.startS);
          expect(drop.endS).toBeLessThanOrEqual(durationS + 1e-9);
          if (k > 0) expect(drop.binStart).toBeGreaterThan(drops[k - 1]?.binEnd as number);
        });
      }),
    );
  });

  it("needs a 100-point curve", () => {
    expect(() => findDrops([0.9, 0.8], 60)).toThrow(/100 points/);
  });
});

describe("binLosses", () => {
  it("counts each bin's loss in points, from a start of 1, never below 0", () => {
    const curve = curveFrom(lossesWith({ 2: 1.5 }));
    curve[50] = (curve[49] as number) + 0.001; // a rise from rounding counts as no loss
    const losses = binLosses(curve);
    expect(losses[0]).toBeCloseTo(10, 10);
    expect(losses[1]).toBeCloseTo(1.5, 10);
    expect(losses[50]).toBe(0);
  });
});
