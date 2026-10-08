/**
 * Agreement between two annotations of the same videos: how consistently
 * Gemini labels a video across runs, and how closely it matches a person.
 * Labels are compared second by second, so long beats weigh more than short.
 */

/** Counts of each (first label, second label) pair. */
export function confusionMatrix<T>(
  first: readonly T[],
  second: readonly T[],
): Map<T, Map<T, number>> {
  checkPaired(first, second);
  const matrix = new Map<T, Map<T, number>>();
  first.forEach((label, index) => {
    const row = matrix.get(label) ?? new Map<T, number>();
    const other = second[index] as T;
    row.set(other, (row.get(other) ?? 0) + 1);
    matrix.set(label, row);
  });
  return matrix;
}

function checkPaired(first: readonly unknown[], second: readonly unknown[]): void {
  if (first.length !== second.length) {
    throw new RangeError(`Sequences differ in length: ${first.length} and ${second.length}`);
  }
  if (first.length === 0) throw new RangeError("Agreement needs at least one paired item");
}

/**
 * Cohen's kappa: agreement beyond chance, `(p_o - p_e) / (1 - p_e)`. 1 is
 * perfect, 0 is chance. Null when chance agreement is already 1 (both
 * annotations use one and the same label throughout), where kappa is undefined.
 */
export function cohenKappa<T>(first: readonly T[], second: readonly T[]): number | null {
  checkPaired(first, second);
  const n = first.length;
  let observed = 0;
  const firstCounts = new Map<T, number>();
  const secondCounts = new Map<T, number>();
  first.forEach((label, index) => {
    const other = second[index] as T;
    if (label === other) observed += 1;
    firstCounts.set(label, (firstCounts.get(label) ?? 0) + 1);
    secondCounts.set(other, (secondCounts.get(other) ?? 0) + 1);
  });
  let expected = 0;
  for (const [label, count] of firstCounts)
    expected += (count / n) * ((secondCounts.get(label) ?? 0) / n);
  if (expected >= 1) return null;
  return (observed / n - expected) / (1 - expected);
}

/**
 * Quadratic-weighted kappa for ordinal ratings on `min..max` (1 to 5 here):
 * disagreements cost the square of their distance, so 2 vs 3 is a near miss
 * and 1 vs 5 the worst case. `1 - sum(w * observed) / sum(w * expected)`.
 * Null when there is no expected disagreement to compare against.
 */
export function quadraticWeightedKappa(
  first: readonly number[],
  second: readonly number[],
  { min, max }: { min: number; max: number },
): number | null {
  checkPaired(first, second);
  const k = max - min + 1;
  if (!Number.isInteger(k) || k < 2)
    throw new RangeError(`Need at least two categories, got ${min}..${max}`);
  const n = first.length;
  const observed = Array.from({ length: k }, () => Array<number>(k).fill(0));
  const firstMargin = Array<number>(k).fill(0);
  const secondMargin = Array<number>(k).fill(0);
  first.forEach((rating, index) => {
    const i = rating - min;
    const j = (second[index] as number) - min;
    if (!(i >= 0 && i < k && j >= 0 && j < k && Number.isInteger(i) && Number.isInteger(j))) {
      throw new RangeError(`Rating outside ${min}..${max}: ${rating} or ${second[index]}`);
    }
    (observed[i] as number[])[j] = ((observed[i] as number[])[j] as number) + 1;
    firstMargin[i] = (firstMargin[i] as number) + 1;
    secondMargin[j] = (secondMargin[j] as number) + 1;
  });
  let weightedObserved = 0;
  let weightedExpected = 0;
  for (let i = 0; i < k; i += 1) {
    for (let j = 0; j < k; j += 1) {
      const weight = (i - j) ** 2 / (k - 1) ** 2;
      weightedObserved += weight * ((observed[i] as number[])[j] as number);
      weightedExpected += (weight * (firstMargin[i] as number) * (secondMargin[j] as number)) / n;
    }
  }
  if (weightedExpected === 0) return null;
  return 1 - weightedObserved / weightedExpected;
}

/**
 * F1 of two sets of boundary times: a boundary matches one in the other set
 * within `tolerance` seconds, each at most once. Two sorted lists matched
 * greedily from the left give the largest possible matching on a line.
 * Both empty (no boundaries at all) counts as perfect agreement.
 */
export function boundaryF1(
  first: readonly number[],
  second: readonly number[],
  tolerance: number,
): { f1: number; matched: number; first: number; second: number } {
  const a = [...first].sort((x, y) => x - y);
  const b = [...second].sort((x, y) => x - y);
  let matched = 0;
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    const difference = (a[i] as number) - (b[j] as number);
    if (Math.abs(difference) <= tolerance) {
      matched += 1;
      i += 1;
      j += 1;
    } else if (difference < 0) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const total = a.length + b.length;
  return {
    f1: total === 0 ? 1 : (2 * matched) / total,
    matched,
    first: a.length,
    second: b.length,
  };
}

/** Ranks from 1, ties sharing the average of their ranks. */
function ranks(values: readonly number[]): number[] {
  const order = values.map((value, index) => ({ value, index })).sort((x, y) => x.value - y.value);
  const result = Array<number>(values.length);
  for (let start = 0; start < order.length;) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.value === order[start]?.value) end += 1;
    const rank = (start + end) / 2 + 1;
    for (let k = start; k <= end; k += 1) result[(order[k] as { index: number }).index] = rank;
    start = end + 1;
  }
  return result;
}

/** Spearman's rank correlation (Pearson on average ranks); null when either side is constant. */
export function spearman(first: readonly number[], second: readonly number[]): number | null {
  checkPaired(first, second);
  const x = ranks(first);
  const y = ranks(second);
  const mean = (v: number[]) => v.reduce((sum, value) => sum + value, 0) / v.length;
  const mx = mean(x);
  const my = mean(y);
  let covariance = 0;
  let vx = 0;
  let vy = 0;
  x.forEach((value, index) => {
    const dx = value - mx;
    const dy = (y[index] as number) - my;
    covariance += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  });
  if (vx === 0 || vy === 0) return null;
  return covariance / Math.sqrt(vx * vy);
}

/**
 * Mean absolute difference over pairs where both values exist, plus how many
 * pairs disagree on whether there is a value at all (one null, one not).
 */
export function meanAbsoluteDifference(
  pairs: ReadonlyArray<readonly [number | null, number | null]>,
): {
  mean: number | null;
  compared: number;
  oneMissing: number;
} {
  let total = 0;
  let compared = 0;
  let oneMissing = 0;
  for (const [a, b] of pairs) {
    if (a !== null && b !== null) {
      total += Math.abs(a - b);
      compared += 1;
    } else if (a !== null || b !== null) {
      oneMissing += 1;
    }
  }
  return { mean: compared > 0 ? total / compared : null, compared, oneMissing };
}

/** A span with a start and end in seconds, like a beat. */
export interface Span {
  start_s: number;
  end_s: number;
}

/**
 * One label per whole second of the video, taken from the span covering the
 * middle of that second; null where no span does.
 */
export function perSecond<S extends Span, L>(
  spans: readonly S[],
  durationS: number,
  label: (span: S) => L,
): Array<L | null> {
  const seconds = Math.floor(durationS);
  const sorted = [...spans].sort((a, b) => a.start_s - b.start_s);
  const result: Array<L | null> = [];
  let index = 0;
  for (let second = 0; second < seconds; second += 1) {
    const middle = second + 0.5;
    while (index < sorted.length && (sorted[index] as S).end_s <= middle) index += 1;
    const span = sorted[index];
    result.push(span && span.start_s <= middle ? label(span) : null);
  }
  return result;
}

/** The two sequences restricted to seconds where both have a label. */
export function bothLabelled<L>(
  first: ReadonlyArray<L | null>,
  second: ReadonlyArray<L | null>,
): [L[], L[]] {
  if (first.length !== second.length) throw new RangeError("Sequences differ in length");
  const a: L[] = [];
  const b: L[] = [];
  first.forEach((label, index) => {
    const other = second[index];
    if (label !== null && other !== null && other !== undefined) {
      a.push(label);
      b.push(other);
    }
  });
  return [a, b];
}

/** Where one beat ends and the next starts: every start except the first. */
export function internalBoundaries(spans: readonly Span[]): number[] {
  return [...spans]
    .sort((a, b) => a.start_s - b.start_s)
    .slice(1)
    .map((span) => span.start_s);
}
