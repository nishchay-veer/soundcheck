/**
 * ISO 8601 durations as the YouTube Data API writes them: `PT4M22S`,
 * `PT1H2M`, `P1DT2H` for long streams, `P0D` for an upcoming stream. Years and
 * months have no fixed length, so they are rejected.
 */
const DURATION = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Whole seconds in an ISO 8601 duration (fractions are rounded down). */
export function parseIsoDuration(value: string): number {
  const match = DURATION.exec(value);
  if (!match || value === "P" || value.endsWith("T")) {
    throw new RangeError(`Not a supported ISO 8601 duration: ${value}`);
  }
  const [weeks, days, hours, minutes, seconds] = match.slice(1).map((part) => Number(part ?? 0));
  return Math.floor(
    (weeks ?? 0) * 604_800 +
      (days ?? 0) * 86_400 +
      (hours ?? 0) * 3_600 +
      (minutes ?? 0) * 60 +
      (seconds ?? 0),
  );
}
