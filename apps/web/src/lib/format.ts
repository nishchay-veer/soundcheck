/**
 * How numbers appear on screen. Never more precision than an interval
 * supports: one decimal for percentage points and view percentages, whole
 * percentages for shares. Negative numbers use a true minus sign.
 */

const MINUS = "−";

/** One decimal with a sign: "+4.2", "−2.1", "0.0". */
export function signed(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  if (Number(fixed) === 0) return fixed;
  return `${value > 0 ? "+" : MINUS}${fixed}`;
}

/** One decimal, signed only when negative: "2.1", "−3.4". */
export function plain(value: number, digits = 1): string {
  const fixed = Math.abs(value).toFixed(digits);
  return value < 0 && Number(fixed) !== 0 ? `${MINUS}${fixed}` : fixed;
}

/** A share as a whole percentage: 0.617 is "62%". */
export function formatShare(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** A percentage with one decimal: 41.27 is "41.3%". */
export function formatPercent(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

const counts = new Intl.NumberFormat("en");

/** A count with thousands separators: "1,204". */
export function formatCount(value: number): string {
  return counts.format(value);
}

/** Seconds as a clock time, "M:SS" (minutes may pass 59). */
export function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
