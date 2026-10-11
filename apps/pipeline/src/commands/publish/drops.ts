import { MAX_DROPS, TIMELINE_BINS } from "@soundcheck/core/schemas";

/**
 * Drop-offs (Phase 11): where an audience left fastest, from its measured
 * survival curve.
 *
 * - A bin is a candidate when its 3-bin rolling loss (its own loss and its
 *   neighbours') is in the video's top decile and above 1.5 percentage
 *   points. Bin 1 is left out, as in Phase 09's drop-off metric: every
 *   video's largest loss is its first second.
 * - Neighbouring candidates merge into one stretch, the bins their windows
 *   cover. Edge bins that lose no more than the video's median bin are
 *   trimmed off, so a one-bin spike is reported as that bin.
 * - The largest {@link MAX_DROPS} stretches are kept, in time order.
 */

export const DROP_RULE = {
  /** The 3-bin rolling loss must exceed this, in percentage points. */
  minLossPp: 1.5,
  /** And be in this top share of the video's bins. */
  topShare: 0.1,
  /** The first bin searched (bins count from 1). */
  firstBin: 2,
} as const;

export interface DropSpan {
  /** Bins from 1 to 100, inclusive. */
  binStart: number;
  binEnd: number;
  startS: number;
  endS: number;
  /** Share of the audience lost over the stretch, in percentage points. */
  actualLossPp: number;
}

/** Percentage points lost in each bin (index 0 is bin 1); the curve starts at 1. */
export function binLosses(curve: readonly number[]): number[] {
  if (curve.length !== TIMELINE_BINS) {
    throw new RangeError(`A curve has ${TIMELINE_BINS} points, got ${curve.length}`);
  }
  return curve.map((share, i) =>
    Math.max(0, ((i === 0 ? 1 : (curve[i - 1] as number)) - share) * 100),
  );
}

/** The q-quantile of values, interpolating linearly between neighbours. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const low = sorted[below] as number;
  const high = sorted[Math.min(below + 1, sorted.length - 1)] as number;
  return low + (position - below) * (high - low);
}

/** The drop-offs in one audience's measured curve of a video lasting `durationS`. */
export function findDrops(curve: readonly number[], durationS: number): DropSpan[] {
  const loss = binLosses(curve);
  const first = DROP_RULE.firstBin - 1; // as an index
  const last = TIMELINE_BINS - 1;
  const searched = loss.slice(first);
  const rolling = (i: number) =>
    (i - 1 >= first ? (loss[i - 1] as number) : 0) +
    (loss[i] as number) +
    (i + 1 <= last ? (loss[i + 1] as number) : 0);

  const windows = Array.from({ length: searched.length }, (_, k) => rolling(k + first));
  // Strictly above the cut-off, so a flat stretch of equal bins is never "top".
  const cutoff = quantile(windows, 1 - DROP_RULE.topShare);
  const candidate = (i: number) => {
    const value = rolling(i);
    return value > cutoff && value > DROP_RULE.minLossPp;
  };

  // Each run of neighbouring candidates covers its windows; runs whose
  // windows touch become one stretch.
  const stretches: [number, number][] = [];
  for (let i = first; i <= last; i += 1) {
    if (!candidate(i)) continue;
    const start = Math.max(first, i - 1);
    const end = Math.min(last, i + 1);
    const previous = stretches.at(-1);
    if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
    else stretches.push([start, end]);
  }

  const usual = quantile(searched, 0.5);
  const spans = stretches.map(([from, to]) => {
    let start = from;
    let end = to;
    while (start < end && (loss[start] as number) <= usual) start += 1;
    while (end > start && (loss[end] as number) <= usual) end -= 1;
    const before = start === 0 ? 1 : (curve[start - 1] as number);
    return {
      binStart: start + 1,
      binEnd: end + 1,
      startS: (start / TIMELINE_BINS) * durationS,
      endS: ((end + 1) / TIMELINE_BINS) * durationS,
      actualLossPp: (before - (curve[end] as number)) * 100,
    };
  });

  return spans
    .filter((span) => span.actualLossPp > 0)
    .sort((a, b) => b.actualLossPp - a.actualLossPp || a.binStart - b.binStart)
    .slice(0, MAX_DROPS)
    .sort((a, b) => a.binStart - b.binStart);
}
