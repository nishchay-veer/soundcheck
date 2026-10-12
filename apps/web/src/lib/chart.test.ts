import { describe, expect, it } from "vitest";
import { CHART, chartScales, curvePoints, timeTicks } from "./chart";

describe("chart geometry", () => {
  it("ticks time at round steps", () => {
    expect(timeTicks(212)).toEqual([0, 60, 120, 180]);
    expect(timeTicks(88)).toEqual([0, 15, 30, 45, 60, 75]);
    expect(timeTicks(3600)).toEqual([0, 600, 1200, 1800, 2400, 3000, 3600]);
  });

  it("never draws narrower than the minimum, and clips rewatches above 100%", () => {
    expect(chartScales(390, 100).width).toBe(CHART.minWidth);
    expect(chartScales(1100, 100).width).toBe(1100);
    const { y } = chartScales(800, 100);
    expect(y(130)).toBe(y(100));
  });

  it("starts every curve at 100% at 0 s and ends each bin at its share of the video", () => {
    const points = curvePoints(
      Array.from({ length: 100 }, () => 0.5),
      200,
    );
    expect(points[0]).toEqual([0, 100]);
    expect(points[60]).toEqual([120, 50]);
    expect(points).toHaveLength(101);
  });
});
