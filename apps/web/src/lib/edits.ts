import {
  AUDIENCE_LABELS,
  measuredAudienceSchema,
  type Chapter,
  type Edit,
  type MeasuredAudience,
  type Percentiles,
  type SimulatedSpan,
  type SoundcheckPrediction,
  type VideoBeat,
} from "@soundcheck/core/schemas";
import { formatClock, plain, signed } from "./format";

/**
 * The edit list's numbers and exports (Phase 15): how an edit's effect reads,
 * which edits are sure, the cut list for an editor, and YouTube chapters for
 * the edited cut.
 */

/** What edits are judged on: seconds watched, or the share of the cut watched. */
export type Objective = "avd" | "avp";

/** An edit's own effect in the objective's unit. */
export const deltaOf = (edit: Pick<Edit, "deltaAvdS" | "deltaAvpPp">, objective: Objective) =>
  objective === "avd" ? edit.deltaAvdS : edit.deltaAvpPp;

/** Sure: the whole interval of gain is above zero. Otherwise it is shown as uncertain. */
export const isSure = (delta: Percentiles) => delta.p10 > 0;

/** Best typical gain first, in the chosen objective. */
export const rankEdits = (edits: readonly Edit[], objective: Objective): Edit[] =>
  edits.toSorted((a, b) => deltaOf(b, objective).p50 - deltaOf(a, objective).p50);

const MINUS = "−";

/** Seconds, short: "4.2 s" under 10 s, "12 s" under a minute, then "1:05". */
function seconds(value: number, sign: boolean): string {
  const size = Math.abs(value);
  const mark = value < 0 ? MINUS : sign ? "+" : "";
  if (size < 10 && Number(size.toFixed(1)) !== 0) return `${mark}${size.toFixed(1)} s`;
  if (size < 59.5) return `${Math.round(size) === 0 ? "" : mark}${Math.round(size)} s`;
  return `${mark}${formatClock(size)}`;
}

/** An effect with its interval: "+12 s (8 s to 16 s)" or "+3.2 pp (1.1 to 5.0)". */
export function formatDelta(delta: Percentiles, objective: Objective): string {
  if (objective === "avp") {
    return `${signed(delta.p50)} pp (${plain(delta.p10)} to ${plain(delta.p90)})`;
  }
  return `${seconds(delta.p50, true)} (${seconds(delta.p10, false)} to ${seconds(delta.p90, false)})`;
}

/** A time for an editor's timeline: "1:20.5". */
export function timecode(value: number): string {
  const tenths = Math.round(value * 10);
  const whole = Math.floor(tenths / 10);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}.${tenths % 10}`;
}

const csvField = (text: string) => (/[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);

/**
 * The ticked edits as a cut list in the cut's own times, earliest first:
 * `start,end,action,note`. A trim cuts the end of its beat; a move names
 * where the beat goes.
 */
export function cutList(
  edits: readonly Edit[],
  beats: readonly VideoBeat[],
  durationS: number,
): string {
  const rows = edits.map(({ edit, startS, endS, label }) => {
    if (edit.op === "trim") {
      return { start: startS + (endS - startS) * edit.keep, end: endS, action: "Cut", note: label };
    }
    if (edit.op === "move") {
      const target = edit.to < beats.length ? (beats[edit.to]?.startS ?? durationS) : durationS;
      const where = edit.to < beats.length ? `before ${timecode(target)}` : "to the end";
      return { start: startS, end: endS, action: "Move", note: `${label}: place it ${where}` };
    }
    return { start: startS, end: endS, action: "Cut", note: label };
  });
  return [
    "start,end,action,note",
    ...rows
      .toSorted((a, b) => a.start - b.start)
      .map((row) =>
        [timecode(row.start), timecode(row.end), row.action, csvField(row.note)].join(","),
      ),
  ].join("\n");
}

/** YouTube's rules for chapters in a description. */
export const CHAPTER_RULES = { min: 3, minSeconds: 10 } as const;

/** A chapter time as YouTube reads it: "4:05", or "1:02:05" past an hour. */
function chapterTime(value: number): string {
  const whole = Math.max(0, Math.round(value));
  const hours = Math.floor(whole / 3600);
  const rest = formatClock(whole % 3600);
  return hours ? `${hours}:${rest.padStart(5, "0")}` : rest;
}

/**
 * The cut's chapters for its description, after `spans` re-timed the beats
 * (null: the cut as it is). A chapter starts where the earliest of its beats
 * now starts. A moved beat counts only when it opens its chapter: a payoff that
 * opens "The verdict" takes the chapter along, while a sponsor moved out of
 * the middle of a chapter starts none. A chapter whose beats are all cut is
 * gone; the first starts at 0:00; chapters shorter than 10 s fold into the one
 * before. YouTube needs at least 3; when the edited cut has fewer, it says so.
 */
export function chaptersText(
  chapters: readonly Chapter[],
  beats: readonly VideoBeat[],
  spans: readonly SimulatedSpan[] | null,
  durationS: number,
): { text: string } | { problem: string } {
  const placed =
    spans ?? beats.map((beat, index) => ({ beat: index, startS: beat.startS, edit: null }));
  const chapterOf = (beat: number) =>
    chapters.reduce((found, chapter, i) => (chapter.firstBeat <= beat ? i : found), 0);
  const starts = new Map<number, number>();
  for (const span of placed) {
    const chapter = chapterOf(span.beat);
    if (span.edit === "move" && chapters[chapter]?.firstBeat !== span.beat) continue;
    starts.set(chapter, Math.min(starts.get(chapter) ?? Infinity, span.startS));
  }
  let list = [...starts]
    .map(([chapter, start]) => ({ title: (chapters[chapter] as Chapter).title, start }))
    .toSorted((a, b) => a.start - b.start);
  if (list[0]) list[0] = { ...list[0], start: 0 };
  // Fold chapters shorter than the minimum into the one before (the first absorbs the second).
  for (;;) {
    const short = list.findIndex(
      (chapter, i) => (list[i + 1]?.start ?? durationS) - chapter.start < CHAPTER_RULES.minSeconds,
    );
    if (short === -1 || list.length === 1) break;
    list = list.filter((_, i) => i !== (short === 0 ? 1 : short));
  }
  if (list.length < CHAPTER_RULES.min) {
    return {
      problem: `YouTube needs at least ${CHAPTER_RULES.min} chapters of ${CHAPTER_RULES.minSeconds} seconds or more; this cut has ${list.length}.`,
    };
  }
  return {
    text: list.map((chapter) => `${chapterTime(chapter.start)} ${chapter.title}`).join("\n"),
  };
}

/**
 * What an edit does to a beat, for the strip of the cut as it is: cut from a
 * share of the beat onward (0 cuts all of it), or moved.
 */
export type BeatMark = { cutFrom: number } | { moved: true };

/** What each edit does to its beat, by beat index. */
export function marksFor(edits: readonly Pick<Edit, "edit">[]): Map<number, BeatMark> {
  return new Map(
    edits.map(({ edit }) => [
      edit.beat,
      edit.op === "move" ? { moved: true } : { cutFrom: edit.op === "trim" ? edit.keep : 0 },
    ]),
  );
}

/** A time in the edited cut, in the cut as it is (to seek the original video); null when it is not in the cut. */
export function toOriginal(spans: readonly SimulatedSpan[], t: number): number | null {
  const span = spans.find((s) => t >= s.startS && t < s.endS) ?? spans.at(-1);
  if (!span || t < 0) return null;
  return Math.min(span.toS, span.fromS + (Math.min(t, span.endS) - span.startS));
}

/** A time in the cut as it is, in the edited cut (for the playhead); null when it was cut. */
export function toEdited(spans: readonly SimulatedSpan[], t: number): number | null {
  const span = spans.find((s) => t >= s.fromS && t < s.toS);
  if (!span) return null;
  const into = t - span.fromS;
  return into <= span.endS - span.startS ? span.startS + into : null;
}

/**
 * Whether a soundcheck's edits can be recommended, and on whom: on every
 * audience (`all`); on the audiences whose model is usable, the others left out
 * (`some`, labels); or on none, because no model is usable or the usable ones
 * bring too few of the views. `judgedOn` is the job's `editsJudgedOn`: null on
 * soundchecks from before it, which recommended only when every model was usable.
 */
export type Recommending =
  | { kind: "all" }
  | { kind: "some"; on: string[]; without: string[] }
  | { kind: "none"; why: "not-usable" | "too-few-views" };

export function recommendingOf(
  prediction: SoundcheckPrediction | null,
  judgedOn: readonly MeasuredAudience[] | null,
): Recommending {
  if (!prediction) return { kind: "none", why: "not-usable" };
  const present = measuredAudienceSchema.options.filter((key) => prediction.audiences[key]);
  const usable = present.filter((key) => prediction.audiences[key]?.model.usable);
  const judged = judgedOn ?? present;
  if (judged.length && judged.every((key) => usable.includes(key))) {
    const without = present.filter((key) => !judged.includes(key));
    return without.length
      ? {
          kind: "some",
          on: judged.map((key) => AUDIENCE_LABELS[key]),
          without: without.map((key) => AUDIENCE_LABELS[key]),
        }
      : { kind: "all" };
  }
  return { kind: "none", why: judgedOn && usable.length ? "too-few-views" : "not-usable" };
}
