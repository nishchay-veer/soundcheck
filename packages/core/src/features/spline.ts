/**
 * B-spline basis functions by the Cox–de Boor recursion, for the position
 * features `pos_b*`. Checked against scipy's `BSpline` in
 * `tests/fixtures/spline.json` (written by `services/modeling/scripts/spline_fixture.py`).
 */

/** The knot vector of a clamped spline on [0, 1]: each end repeated `degree + 1` times. */
export function clampedKnots(interior: readonly number[], degree: number): number[] {
  if (!Number.isInteger(degree) || degree < 0) throw new RangeError(`Invalid degree: ${degree}`);
  interior.forEach((knot, index) => {
    if (!(knot > 0 && knot < 1) || (index > 0 && knot <= (interior[index - 1] as number))) {
      throw new RangeError(`Interior knots must increase strictly inside (0, 1): ${interior}`);
    }
  });
  return [...Array<number>(degree + 1).fill(0), ...interior, ...Array<number>(degree + 1).fill(1)];
}

/**
 * Every basis function of the given degree at `x`, in knot order. Intervals
 * are half-open, `[t_i, t_i+1)`, except that `x` at the last knot belongs to
 * the last non-empty interval, so the basis sums to 1 on the whole closed range.
 */
export function bsplineBasis(x: number, knots: readonly number[], degree: number): number[] {
  const first = knots[0] as number;
  const last = knots[knots.length - 1] as number;
  if (!Number.isFinite(x) || x < first || x > last) {
    throw new RangeError(`x must lie within [${first}, ${last}], got ${x}`);
  }
  const count = knots.length - degree - 1;
  if (count < 1) throw new RangeError(`${knots.length} knots are too few for degree ${degree}`);

  const knot = (i: number) => knots[i] as number;
  // Degree 0: the indicator of the interval that holds x.
  let basis: number[] = Array.from({ length: knots.length - 1 }, (_, i) =>
    knot(i) <= x && x < knot(i + 1) ? 1 : 0,
  );
  if (x === last) {
    let i = knots.length - 2;
    while (i > 0 && knot(i) === knot(i + 1)) i -= 1;
    basis[i] = 1;
  }
  // Raise the degree one step at a time; a term whose knot span is empty is 0.
  for (let k = 1; k <= degree; k += 1) {
    basis = Array.from({ length: knots.length - 1 - k }, (_, i) => {
      const leftSpan = knot(i + k) - knot(i);
      const rightSpan = knot(i + k + 1) - knot(i + 1);
      const left = leftSpan > 0 ? ((x - knot(i)) / leftSpan) * (basis[i] as number) : 0;
      const right =
        rightSpan > 0 ? ((knot(i + k + 1) - x) / rightSpan) * (basis[i + 1] as number) : 0;
      return left + right;
    });
  }
  return basis;
}
