import {
  geminiVideoBeatsSchema,
  toVideoBeats,
  wordsPerMinute,
  type Beat,
  type VideoBeats,
} from "../schemas/beats";

/** Gaps and overlaps shorter than this are closed silently. */
export const MAX_SNAP_S = 2;
/** Beats must cover at least this share of the video. */
export const MIN_COVERAGE = 0.95;
export const MIN_BEAT_S = 1;
export const MAX_BEAT_S = 600;

export type BeatsValidation =
  | {
      ok: true;
      beats: VideoBeats;
      /** Share of the video covered by beats, 0 to 1. */
      coverage: number;
      /** Small repairs made, for the log. */
      fixes: string[];
    }
  | {
      ok: false;
      /** Specific problems, phrased for Gemini: they are appended to the retry. */
      errors: string[];
    };

/** "M:SS", the way Gemini writes times, for error messages it will read. */
export function formatClock(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Checks and repairs one extraction against the video's duration:
 * 1. parse Gemini's JSON against the schema and convert times to seconds;
 * 2. sort beats; close gaps and overlaps under 2 s by moving the earlier
 *    beat's end (the first beat starts at 0, the last ends at the duration);
 * 3. reject a beat that starts after the video ends, ends before it starts,
 *    or lasts under 1 s or over 600 s, an overlap of 2 s or more, a payoff
 *    after the end, or coverage under 95%.
 * Words per minute are recomputed after any repair.
 */
export function validateBeats(answer: unknown, durationS: number): BeatsValidation {
  if (!(durationS > 0)) throw new RangeError(`Video duration must be positive, got ${durationS}`);
  const parsed = geminiVideoBeatsSchema.safeParse(answer);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) =>
          `Your output does not match the schema at ${issue.path.join(".") || "the top level"}: ${issue.message}.`,
      ),
    };
  }
  return checkBeats(toVideoBeats(parsed.data), durationS);
}

/**
 * The checks and repairs of `validateBeats` on beats already in seconds: also
 * used on stitched windows of a long video.
 */
export function checkBeats(video: VideoBeats, durationS: number): BeatsValidation {
  if (!(durationS > 0)) throw new RangeError(`Video duration must be positive, got ${durationS}`);
  const errors: string[] = [];
  const fixes: string[] = [];
  const beats: Beat[] = [...video.beats]
    .sort((a, b) => a.start_s - b.start_s || a.end_s - b.end_s)
    .map((beat) => ({ ...beat }));

  for (const beat of beats) {
    if (beat.start_s >= durationS) {
      errors.push(
        `A beat starts at ${formatClock(beat.start_s)}, after the video ends at ${formatClock(durationS)}.`,
      );
    } else if (beat.end_s <= beat.start_s) {
      errors.push(
        `The beat at ${formatClock(beat.start_s)} ends at ${formatClock(beat.end_s)}, before it starts.`,
      );
    }
  }
  if (errors.length > 0) return { ok: false, errors };

  // Snap the edges and the joins between neighbours.
  const first = beats[0] as Beat;
  if (first.start_s > 0 && first.start_s < MAX_SNAP_S) {
    fixes.push(`first beat moved from ${first.start_s} s to 0 s`);
    first.start_s = 0;
  }
  for (let i = 1; i < beats.length; i += 1) {
    const previous = beats[i - 1] as Beat;
    const current = beats[i] as Beat;
    const gap = current.start_s - previous.end_s;
    if (gap === 0) continue;
    if (Math.abs(gap) < MAX_SNAP_S) {
      fixes.push(
        `${gap > 0 ? "gap" : "overlap"} of ${Math.abs(gap).toFixed(1)} s at ${formatClock(current.start_s)} closed`,
      );
      previous.end_s = current.start_s;
    } else if (gap < 0) {
      errors.push(
        `Your output has beats that overlap from ${formatClock(current.start_s)} to ${formatClock(previous.end_s)}. Beats must not overlap.`,
      );
    }
  }
  const last = beats[beats.length - 1] as Beat;
  if (last.end_s > durationS) {
    fixes.push(`last beat clamped from ${last.end_s} s to the duration, ${durationS} s`);
    last.end_s = durationS;
  } else if (durationS - last.end_s < MAX_SNAP_S && last.end_s < durationS) {
    fixes.push(`last beat extended from ${last.end_s} s to the duration, ${durationS} s`);
    last.end_s = durationS;
  }

  for (const beat of beats) {
    const length = beat.end_s - beat.start_s;
    if (length < MIN_BEAT_S) {
      errors.push(
        `The beat at ${formatClock(beat.start_s)} lasts ${length.toFixed(1)} s; beats last at least ${MIN_BEAT_S} s.`,
      );
    } else if (length > MAX_BEAT_S) {
      errors.push(
        `The beat from ${formatClock(beat.start_s)} to ${formatClock(beat.end_s)} lasts ${Math.round(length)} s; split it, beats last at most ${MAX_BEAT_S} s.`,
      );
    }
  }
  if (video.payoff_time_s !== null && video.payoff_time_s > durationS) {
    errors.push(
      `The payoff time ${formatClock(video.payoff_time_s)} is after the video ends at ${formatClock(durationS)}.`,
    );
  }

  const gaps = uncovered(beats, durationS);
  const covered = durationS - gaps.reduce((sum, [from, to]) => sum + (to - from), 0);
  const coverage = covered / durationS;
  if (coverage < MIN_COVERAGE) {
    const where = gaps
      .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))
      .slice(0, 3)
      .map(([from, to]) => `from ${formatClock(from)} to ${formatClock(to)}`)
      .join(", ");
    errors.push(
      `Your output covers ${(coverage * 100).toFixed(0)}% of the video; it has a gap ${where}. Beats must cover the whole video, from 0:00 to ${formatClock(durationS)}.`,
    );
  }
  if (errors.length > 0) return { ok: false, errors };

  for (const beat of beats) {
    beat.words_per_minute = wordsPerMinute(beat.transcript, beat.end_s - beat.start_s);
  }
  return { ok: true, beats: { ...video, beats }, coverage, fixes };
}

/** Spans of [0, duration] no beat covers, in order. */
function uncovered(beats: readonly Beat[], durationS: number): Array<[number, number]> {
  const gaps: Array<[number, number]> = [];
  let cursor = 0;
  for (const beat of beats) {
    if (beat.start_s > cursor) gaps.push([cursor, beat.start_s]);
    cursor = Math.max(cursor, beat.end_s);
  }
  if (cursor < durationS) gaps.push([cursor, durationS]);
  return gaps;
}
