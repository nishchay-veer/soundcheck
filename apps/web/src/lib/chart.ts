import { scaleLinear, type ScaleLinear } from "d3-scale";
import { area, line } from "d3-shape";

/**
 * The autopsy chart's geometry (Phase 13), shared by the retention chart and
 * the beat strip so both use one time scale: a beat starting at 60 s and the
 * curve's point at 60 s sit at the same x. D3 does the maths; React draws.
 */

export const CHART = {
  /** Below this width the chart and strip scroll sideways together. */
  minWidth: 640,
  plotHeight: 300,
  stripHeight: 64,
  margin: { top: 16, right: 20, bottom: 36, left: 52 },
} as const;

export interface Scales {
  width: number;
  /** Seconds from the start to x. */
  x: ScaleLinear<number, number>;
  /** Percent still watching (0 to 100) to y. */
  y: ScaleLinear<number, number>;
}

/** Scales for a chart drawn `width` pixels wide (never narrower than `CHART.minWidth`). */
export function chartScales(width: number, durationS: number): Scales {
  const drawn = Math.max(CHART.minWidth, Math.round(width));
  const { margin, plotHeight } = CHART;
  return {
    width: drawn,
    x: scaleLinear()
      .domain([0, durationS])
      .range([margin.left, drawn - margin.right]),
    y: scaleLinear()
      .domain([0, 100])
      .range([plotHeight - margin.bottom, margin.top])
      .clamp(true),
  };
}

const STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];

/** Tick times at a round step (5 s, 30 s, 1 min, 5 min…) giving about `count` ticks. */
export function timeTicks(durationS: number, count = 6): number[] {
  const step = STEPS_S.find((s) => durationS / s <= count) ?? STEPS_S[STEPS_S.length - 1] ?? 3600;
  const ticks: number[] = [];
  for (let t = 0; t <= durationS + 1e-9; t += step) ticks.push(t);
  return ticks;
}

/** A curve's points: everyone watching at 0 s, then each bin's end (bin b ends at b% of the video). */
export function curvePoints(curve: readonly number[], durationS: number): [number, number][] {
  return [
    [0, 100],
    ...curve.map((share, i): [number, number] => [
      ((i + 1) / curve.length) * durationS,
      share * 100,
    ]),
  ];
}

/** The SVG path of a curve in percent still watching over seconds. */
export function curvePath(curve: readonly number[], durationS: number, { x, y }: Scales): string {
  return (
    line<[number, number]>()
      .x(([t]) => x(t))
      .y(([, percent]) => y(percent))(curvePoints(curve, durationS)) ?? ""
  );
}

/** The SVG path of a band between two curves (10th and 90th percentiles). */
export function bandPath(
  low: readonly number[],
  high: readonly number[],
  durationS: number,
  { x, y }: Scales,
): string {
  const lows = curvePoints(low, durationS);
  const highs = curvePoints(high, durationS);
  return (
    area<number>()
      .x((i) => x(lows[i]?.[0] ?? 0))
      .y0((i) => y(lows[i]?.[1] ?? 0))
      .y1((i) => y(highs[i]?.[1] ?? 0))(lows.map((_, i) => i)) ?? ""
  );
}
