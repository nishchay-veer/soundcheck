import { resetEnvCache } from "@soundcheck/core";
import fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shard } from "./shard";

const itemsAndCount = fc.tuple(fc.array(fc.integer()), fc.integer({ min: 1, max: 50 }));

const allSlices = (items: number[], count: number): number[][] =>
  Array.from({ length: count }, (_, index) => shard(items, { index, count }));

describe("shard", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("covers every item exactly once, in order", () => {
    fc.assert(
      fc.property(itemsAndCount, ([items, count]) => {
        expect(allSlices(items, count).flat()).toEqual(items);
      }),
    );
  });

  it("balances slices to within one item", () => {
    fc.assert(
      fc.property(itemsAndCount, ([items, count]) => {
        const sizes = allSlices(items, count).map((slice) => slice.length);
        expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it("returns everything for a single local run", () => {
    expect(shard(["a", "b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("reads the task position from the Cloud Run environment", () => {
    vi.stubEnv("CLOUD_RUN_TASK_INDEX", "1");
    vi.stubEnv("CLOUD_RUN_TASK_COUNT", "3");
    expect(shard([0, 1, 2, 3, 4, 5])).toEqual([2, 3]);
  });

  it("rejects an index outside the task count", () => {
    expect(() => shard([1, 2], { index: 2, count: 2 })).toThrow(RangeError);
    expect(() => shard([1, 2], { index: 0, count: 0 })).toThrow(RangeError);
  });
});
