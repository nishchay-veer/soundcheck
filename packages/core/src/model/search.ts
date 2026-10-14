import { buildBins, type FeatureVideo } from "../features";
import {
  AUDIENCE_LABELS,
  measuredAudienceSchema,
  type AttributionGroup,
  type BeatType,
  type MeasuredAudience,
  type ModelArtifact,
} from "../schemas";
import {
  applyEdits,
  compareCuts,
  simulateCut,
  type CutComparison,
  type CutEdit,
  type CutSampler,
  type EditedSpan,
  type Objective,
  type SimulatedCut,
} from "./counterfactual";
import type { AudienceMix } from "./cut";
import { groupOf } from "./groups";
import { logitTerms } from "./runtime";

/**
 * Searching for edits that help a cut (Phase 15): every single edit is
 * simulated on the soundcheck's draws, then edits are taken greedily, one at
 * a time, while the next one's whole interval of gain stays above zero. An
 * edit whose interval crosses zero is never recommended; it is shown as
 * uncertain. Labels and reasons come from templates and the model's own
 * numbers, never from Gemini.
 */

export const SEARCH = {
  /** The most edits recommended together. */
  maxEdits: 5,
  /** The single edits listed. */
  topSingles: 8,
  /** Beats shorter than this are not worth trimming. */
  minTrimS: 10,
} as const;

const MEASURED = measuredAudienceSchema.options;

/** Beats a creator would never cut: the hook and the payoff. */
const NEVER_CUT = new Set<BeatType>(["hook", "payoff"]);
const ENDINGS = new Set<BeatType>(["outro", "end_screen"]);

/** Each beat type as an edit names it. */
export const BEAT_NAMES: Record<BeatType, string> = {
  cold_open: "cold open",
  hook: "hook",
  intro_branding: "branded intro",
  setup: "setup",
  context: "context",
  explanation: "explanation",
  demonstration: "demonstration",
  example: "example",
  story: "story",
  opinion: "opinion",
  tangent: "tangent",
  sponsor: "sponsor read",
  self_promo: "self-promotion",
  cta: "call to action",
  recap: "recap",
  payoff: "payoff",
  transition: "transition",
  outro: "outro",
  end_screen: "end screen",
  performance: "performance",
  other: "section",
};

/** What in a beat the model links to viewers leaving: "mostly because of …". */
const CAUSES: Record<Exclude<AttributionGroup, "position">, string> = {
  sponsor: "the sponsor read",
  branded_intro: "the branded intro",
  call_to_action: "the call to action",
  tangent: "the tangent",
  recap: "the recap",
  payoff: "waiting for the payoff",
  no_visual_change: "nothing changing on screen",
  visuals: "what's on screen",
  on_screen_text: "its on-screen text",
  energy: "its energy",
  pace: "its pace",
  knowledge_gap: "the knowledge it assumes",
  long_beat: "how long it runs",
  music: "its foreground music",
};

/** Why a beat is worth moving, by its type. */
const MOVE_REASONS: Partial<Record<BeatType, string>> = {
  sponsor: "Later in the video, it reaches viewers who are already hooked.",
  self_promo: "Later in the video, it reaches viewers who are already hooked.",
  payoff: "Delivering the payoff sooner cuts how long viewers wait for it.",
  intro_branding: "The hook gets to hold viewers before the branding plays.",
  cta: "Asked near the end, it doesn't interrupt the video.",
  recap: "A recap lands best just before the outro.",
};

const clock = (seconds: number) => {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** A stable ID for an edit: `remove-3`, `trim-5`, `move-3-to-7`. */
export const editId = (edit: CutEdit): string =>
  edit.op === "move" ? `move-${edit.beat}-to-${edit.to}` : `${edit.op}-${edit.beat}`;

/**
 * Every single edit worth trying on a cut:
 * - remove any beat but the hook or the payoff;
 * - trim a beat of at least 10 s (not the payoff) to its first half;
 * - move a beat that can move: a sponsor read or self-promotion to the first
 *   beat boundary after 40% or after 60% of the cut, a payoff to the last
 *   boundary before 25% or 40% (after the hook), a branded intro to just after
 *   the hook, a call to action or a recap to just before the outro (or the end).
 */
export function candidateEdits(video: FeatureVideo, durationS: number): CutEdit[] {
  const spans = applyEdits(video, durationS, []).spans;
  if (spans.length < 2) return [];
  const count = video.beats.length;
  const type = (span: EditedSpan) =>
    (video.beats[span.beat] as FeatureVideo["beats"][number]).beat_type;
  const hook = spans.find((span) => type(span) === "hook");
  const ending = spans.find((span) => ENDINGS.has(type(span)));
  /** The first beat starting at or after a share of the cut. */
  const after = (share: number) =>
    spans.find((span) => span.startS >= share * durationS)?.beat ?? count;
  /** The last beat starting at or before a share of the cut, after the hook. */
  const before = (share: number) =>
    spans.filter((span) => span.startS <= share * durationS && span.beat > (hook?.beat ?? 0)).at(-1)
      ?.beat ?? null;

  const edits: CutEdit[] = [];
  for (const span of spans) {
    const beatType = type(span);
    const { beat } = span;
    if (!NEVER_CUT.has(beatType)) edits.push({ op: "remove", beat });
    if (span.toS - span.fromS >= SEARCH.minTrimS && beatType !== "payoff") {
      edits.push({ op: "trim", beat, keep: 0.5 });
    }
    const targets: (number | null)[] =
      beatType === "sponsor" || beatType === "self_promo"
        ? [after(0.4), after(0.6)]
        : beatType === "payoff"
          ? [before(0.25), before(0.4)]
          : beatType === "intro_branding"
            ? [hook && hook.beat > beat ? hook.beat + 1 : null]
            : beatType === "cta" || beatType === "recap"
              ? [ending && ending.beat > beat ? ending.beat : count]
              : [];
    for (const to of new Set(targets)) {
      // Before itself or its own successor is where it already is.
      if (to === null || to === beat || to === beat + 1) continue;
      edits.push({ op: "move", beat, to });
    }
  }
  return edits;
}

/** Each beat's strongest cause of leaving, by audience: the group whose push on the hazard most exceeds the cut's average. */
function beatCauses(
  artifacts: Partial<Record<MeasuredAudience, ModelArtifact>>,
  video: FeatureVideo,
  durationS: number,
  mix: AudienceMix["mix"],
  spans: readonly EditedSpan[],
): Partial<Record<MeasuredAudience, Map<number, string>>> {
  const result: Partial<Record<MeasuredAudience, Map<number, string>>> = {};
  for (const audience of MEASURED) {
    const artifact = artifacts[audience];
    if (!artifact?.channelContext) continue;
    const frame = buildBins(
      video,
      durationS,
      artifact.channelContext,
      audience === "unsubscribed" ? mix : null,
    );
    const terms = logitTerms(artifact, frame);
    const groups = artifact.featureNames.map(groupOf);
    const byGroup = (rows: readonly Float64Array[]) => {
      const sums = new Map<AttributionGroup, number>();
      for (const row of rows) {
        row.forEach((term, j) => {
          const group = groups[j];
          if (group && group !== "position")
            sums.set(group, (sums.get(group) ?? 0) + term / rows.length);
        });
      }
      return sums;
    };
    const average = byGroup(terms);
    const causes = new Map<number, string>();
    for (const span of spans) {
      // Bins whose middle falls inside the beat.
      const rows = terms.filter((_, bin) => {
        const middle = ((bin + 0.5) / terms.length) * durationS;
        return middle >= span.fromS && middle < span.toS;
      });
      if (!rows.length) continue;
      let best: [AttributionGroup, number] | null = null;
      for (const [group, value] of byGroup(rows)) {
        const excess = value - (average.get(group) ?? 0);
        if (excess > 0 && (!best || excess > best[1])) best = [group, excess];
      }
      if (best) causes.set(span.beat, CAUSES[best[0] as Exclude<AttributionGroup, "position">]);
    }
    result[audience] = causes;
  }
  return result;
}

/** One edit, judged against a cut, with its label and reason. */
export interface ScoredEdit {
  id: string;
  edit: CutEdit;
  /** Where its beat is in the cut as extracted. */
  startS: number;
  endS: number;
  /** The change in seconds watched, and in percentage points of the cut. */
  avdS: CutComparison;
  avp: CutComparison;
  /** Whether the whole interval of gain, in the objective searched on, is above zero. */
  sure: boolean;
  label: string;
  rationale: string;
}

export interface EditSearch {
  baseline: SimulatedCut;
  /**
   * The edits to show: the recommended ones first, in the order taken, then
   * the best other single edits whose median gain is positive (at most
   * `topSingles` of those). Each carries its own effect against the cut as it
   * is, which reads simply; `together` is the recommended set's.
   */
  edits: (ScoredEdit & { recommended: boolean })[];
  /** The recommended edits together, against the cut as it is; null when none is. */
  together: { avdS: CutComparison; avp: CutComparison } | null;
}

/**
 * Searches a cut for edits. `usable` is false while any audience's model is
 * not usable: the edits are still listed, but none is recommended.
 */
export function searchEdits(
  sampler: CutSampler,
  artifacts: Partial<Record<MeasuredAudience, ModelArtifact>>,
  cut: { video: FeatureVideo; durationS: number },
  audienceMix: AudienceMix,
  { objective = "avd", usable }: { objective?: Objective; usable: boolean },
): EditSearch {
  const { video, durationS } = cut;
  const spans = applyEdits(video, durationS, []).spans;
  const span = (beat: number) => spans.find((s) => s.beat === beat) as EditedSpan;
  const causes = beatCauses(artifacts, video, durationS, audienceMix.mix, spans);
  const baseline = simulateCut(sampler, cut, audienceMix.mix);
  const run = (edits: readonly CutEdit[]) => {
    const edited = applyEdits(video, durationS, edits);
    return { edited, simulated: simulateCut(sampler, edited, audienceMix.mix) };
  };
  const judge = (from: SimulatedCut, to: SimulatedCut) => ({
    avdS: compareCuts(sampler, from, to, audienceMix.weights, "avd"),
    avp: compareCuts(sampler, from, to, audienceMix.weights, "avp"),
  });

  const describe = (
    edit: CutEdit,
    edited: ReturnType<typeof applyEdits>,
    change: { avdS: CutComparison; avp: CutComparison },
  ): ScoredEdit => {
    const at = span(edit.beat);
    const beatType = (video.beats[edit.beat] as FeatureVideo["beats"][number]).beat_type;
    const name = BEAT_NAMES[beatType];
    const length = at.toS - at.fromS;
    const chosen = change[objective === "avd" ? "avdS" : "avp"];
    const driver = AUDIENCE_LABELS[chosen.driver];
    const cause = causes[chosen.driver]?.get(edit.beat);
    let label: string;
    let rationale: string;
    if (edit.op === "remove") {
      label = `Cut the ${name} at ${clock(at.fromS)} (${Math.round(length)} s)`;
      rationale = cause
        ? `${driver} are predicted to leave faster during it, mostly because of ${cause}.`
        : `${driver} are predicted to leave a little faster during it.`;
    } else if (edit.op === "trim") {
      label = `Trim the ${name} at ${clock(at.fromS)} to ${Math.round(length * edit.keep)} s`;
      rationale = cause
        ? `${driver} leave faster the longer it runs, mostly because of ${cause}.`
        : `${driver} leave a little faster the longer it runs.`;
    } else {
      const moved = edited.spans.find((s) => s.beat === edit.beat) as EditedSpan;
      label = `Move the ${name} at ${clock(at.fromS)} to ${clock(moved.startS)}`;
      rationale = MOVE_REASONS[beatType] ?? "In its new place, fewer viewers leave during it.";
    }
    return {
      id: editId(edit),
      edit,
      startS: at.fromS,
      endS: at.toS,
      ...change,
      sure: chosen.delta.p10 > 0,
      label,
      rationale,
    };
  };

  // Every single edit, against the cut as it is.
  const candidates = candidateEdits(video, durationS);
  const tried = candidates.map((edit) => {
    const { edited, simulated } = run([edit]);
    return { edit, edited, simulated, change: judge(baseline, simulated) };
  });
  const gain = (change: { avdS: CutComparison; avp: CutComparison }) =>
    change[objective === "avd" ? "avdS" : "avp"].delta;
  const best = tried
    .filter((t) => gain(t.change).p50 > 0)
    .sort((a, b) => gain(b.change).p50 - gain(a.change).p50)
    .slice(0, SEARCH.topSingles);
  const own = (edit: CutEdit, recommended: boolean) => {
    const single = tried.find((t) => editId(t.edit) === editId(edit)) as (typeof tried)[number];
    return { ...describe(single.edit, single.edited, single.change), recommended };
  };
  if (!usable) {
    return { baseline, edits: best.map((t) => own(t.edit, false)), together: null };
  }

  // Greedy: the best next edit, judged on top of those taken, whose whole interval of gain is above zero.
  const taken: CutEdit[] = [];
  let current = baseline;
  let options = tried;
  while (taken.length < SEARCH.maxEdits) {
    const next = options
      .filter((t) => gain(t.change).p10 > 0)
      .sort((a, b) => gain(b.change).p50 - gain(a.change).p50)[0];
    if (!next) break;
    taken.push(next.edit);
    current = next.simulated;
    const edited = new Set(taken.map((edit) => edit.beat));
    options = candidates
      .filter(
        (edit) =>
          !edited.has(edit.beat) &&
          !(edit.op === "move" && taken.some((t) => t.op === "remove" && t.beat === edit.to)),
      )
      .map((edit) => {
        const { edited: after, simulated } = run([...taken, edit]);
        return { edit, edited: after, simulated, change: judge(current, simulated) };
      });
  }
  const takenIds = new Set(taken.map(editId));
  return {
    baseline,
    edits: [
      ...taken.map((edit) => own(edit, true)),
      ...best.filter((t) => !takenIds.has(editId(t.edit))).map((t) => own(t.edit, false)),
    ],
    together: taken.length ? judge(baseline, current) : null,
  };
}
