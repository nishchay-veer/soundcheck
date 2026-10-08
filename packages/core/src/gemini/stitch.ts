import type { Beat, VideoBeats } from "../schemas/beats";
import { MAX_BEAT_S } from "./validate-beats";

/** Videos longer than this are extracted in windows. */
export const SINGLE_PASS_MAX_S = 40 * 60;
export const WINDOW_S = 20 * 60;
export const WINDOW_OVERLAP_S = 30;

export interface ExtractionWindow {
  index: number;
  startS: number;
  endS: number;
}

/**
 * The spans to extract: the whole video up to 40 minutes, otherwise 20-minute
 * windows that each start 30 s before the previous one ends. Each window is
 * sent with `videoMetadata` start and end offsets.
 */
export function extractionWindows(durationS: number): ExtractionWindow[] {
  if (!(durationS > 0)) throw new RangeError(`Video duration must be positive, got ${durationS}`);
  if (durationS <= SINGLE_PASS_MAX_S) return [{ index: 0, startS: 0, endS: durationS }];
  const windows: ExtractionWindow[] = [];
  for (let startS = 0; ; startS += WINDOW_S - WINDOW_OVERLAP_S) {
    const endS = Math.min(startS + WINDOW_S, durationS);
    windows.push({ index: windows.length, startS, endS });
    if (endS >= durationS) return windows;
  }
}

/** A window's beats moved from window time ("0:00" is the window start) to video time. */
export function toVideoTime(window: ExtractionWindow, beats: VideoBeats): VideoBeats {
  const shift = (seconds: number) => seconds + window.startS;
  return {
    ...beats,
    payoff_time_s: beats.payoff_time_s === null ? null : shift(beats.payoff_time_s),
    beats: beats.beats.map((beat) => ({
      ...beat,
      start_s: shift(beat.start_s),
      end_s: shift(beat.end_s),
    })),
  };
}

/**
 * Joins windowed extractions, already in video time and in window order. In
 * each overlap the earlier window wins: later beats that start inside the
 * overlap are dropped, except the one that runs past it, which is merged into
 * the earlier window's last beat when both share a type and the joined beat
 * stays within 600 s, and otherwise starts where that beat ends. A merged beat's transcript joins both, so it can
 * repeat up to 30 s of speech from the overlap. Video-level fields come from
 * the first window; the payoff is the first one any window reports.
 */
export function stitchWindows(
  parts: ReadonlyArray<{ window: ExtractionWindow; beats: VideoBeats }>,
): VideoBeats {
  const [first, ...rest] = parts;
  if (!first) throw new RangeError("Nothing to stitch");
  const beats: Beat[] = first.beats.beats.map((beat) => ({ ...beat }));
  let payoff = first.beats.payoff_time_s;

  for (const { beats: part } of rest) {
    const previous = beats[beats.length - 1];
    if (!previous) throw new RangeError("A window produced no beats");
    const overlapEnd = previous.end_s;
    payoff ??= part.payoff_time_s;
    for (const beat of part.beats) {
      if (beat.end_s <= overlapEnd) continue; // inside the overlap: the earlier window has it
      if (beat.start_s < overlapEnd) {
        // Crosses the end of the overlap: continue the earlier beat or start where it ends.
        const last = beats[beats.length - 1] as Beat;
        if (last.beat_type === beat.beat_type && beat.end_s - last.start_s <= MAX_BEAT_S) {
          last.end_s = beat.end_s;
          last.transcript = [last.transcript, beat.transcript].filter(Boolean).join(" ");
        } else {
          beats.push({ ...beat, start_s: overlapEnd });
        }
        continue;
      }
      beats.push({ ...beat });
    }
  }
  return { ...first.beats, payoff_time_s: payoff, beats };
}
