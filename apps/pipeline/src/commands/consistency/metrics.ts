import type { VideoBeats } from "@soundcheck/core/schemas";
import {
  bothLabelled,
  boundaryF1,
  cohenKappa,
  confusionMatrix,
  internalBoundaries,
  meanAbsoluteDifference,
  perSecond,
  quadraticWeightedKappa,
} from "@soundcheck/core/stats";

/** One video's beats from one run. */
export interface RunExtraction {
  videoId: string;
  durationS: number;
  beats: VideoBeats;
}

export const ORDINAL_FIELDS = ["energy", "assumed_knowledge", "info_density"] as const;
export type OrdinalField = (typeof ORDINAL_FIELDS)[number];

/** Boundaries agree within this many seconds. */
export const BOUNDARY_TOLERANCE_S = 3;

/** The spec's gate (Phase 06). */
export const GATE = {
  boundaryF1: 0.7,
  beatTypeKappa: 0.6,
  framingKappa: 0.7,
  ordinalKappa: 0.5,
} as const;

export interface AgreementMetrics {
  boundaryF1: number;
  beatTypeKappa: number | null;
  framingKappa: number | null;
  ordinal: Record<OrdinalField, number | null>;
  payoff: { meanAbsS: number | null; compared: number; oneMissing: number };
  /** Seconds compared (labelled in both runs), over all videos. */
  seconds: number;
  videos: number;
}

type Beat = VideoBeats["beats"][number];

/**
 * Agreement between two runs over the same videos, pooled: per-second labels
 * of every video are joined into one sequence before computing kappa, and
 * boundary matches are summed, so long videos weigh more and a video with one
 * label throughout cannot make kappa undefined on its own.
 */
export function pairMetrics(
  first: readonly RunExtraction[],
  second: readonly RunExtraction[],
): AgreementMetrics {
  const byVideo = new Map(second.map((run) => [run.videoId, run]));
  const labels = {
    beat_type: [[], []] as [string[], string[]],
    framing: [[], []] as [string[], string[]],
  };
  const ordinal: Record<OrdinalField, [number[], number[]]> = {
    energy: [[], []],
    assumed_knowledge: [[], []],
    info_density: [[], []],
  };
  let matched = 0;
  let boundaries = 0;
  const payoffs: Array<[number | null, number | null]> = [];
  let videos = 0;

  for (const a of first) {
    const b = byVideo.get(a.videoId);
    if (!b) continue;
    videos += 1;
    const duration = Math.min(a.durationS, b.durationS);
    const f1 = boundaryF1(
      internalBoundaries(a.beats.beats),
      internalBoundaries(b.beats.beats),
      BOUNDARY_TOLERANCE_S,
    );
    matched += f1.matched;
    boundaries += f1.first + f1.second;
    payoffs.push([a.beats.payoff_time_s, b.beats.payoff_time_s]);
    const add = <L>(target: [L[], L[]], pick: (beat: Beat) => L) => {
      const [x, y] = bothLabelled(
        perSecond(a.beats.beats, duration, pick),
        perSecond(b.beats.beats, duration, pick),
      );
      target[0].push(...x);
      target[1].push(...y);
    };
    add(labels.beat_type, (beat) => beat.beat_type);
    add(labels.framing, (beat) => beat.framing);
    for (const field of ORDINAL_FIELDS) add(ordinal[field], (beat) => beat[field]);
  }

  const seconds = labels.beat_type[0].length;
  const kappa = ([x, y]: [string[], string[]]) => (x.length > 0 ? cohenKappa(x, y) : null);
  const payoff = meanAbsoluteDifference(payoffs);
  return {
    boundaryF1: boundaries === 0 ? 1 : (2 * matched) / boundaries,
    beatTypeKappa: kappa(labels.beat_type),
    framingKappa: kappa(labels.framing),
    ordinal: Object.fromEntries(
      ORDINAL_FIELDS.map((field) => {
        const [x, y] = ordinal[field];
        return [field, x.length > 0 ? quadraticWeightedKappa(x, y, { min: 1, max: 5 }) : null];
      }),
    ) as Record<OrdinalField, number | null>,
    payoff: { meanAbsS: payoff.mean, compared: payoff.compared, oneMissing: payoff.oneMissing },
    seconds,
    videos,
  };
}

const mean = (values: Array<number | null>): number | null => {
  const present = values.filter((value): value is number => value !== null);
  return present.length > 0
    ? present.reduce((sum, value) => sum + value, 0) / present.length
    : null;
};

/** Each metric averaged over every pair of runs. */
export function averageMetrics(pairs: readonly AgreementMetrics[]): AgreementMetrics {
  return {
    boundaryF1: mean(pairs.map((p) => p.boundaryF1)) ?? 0,
    beatTypeKappa: mean(pairs.map((p) => p.beatTypeKappa)),
    framingKappa: mean(pairs.map((p) => p.framingKappa)),
    ordinal: Object.fromEntries(
      ORDINAL_FIELDS.map((field) => [field, mean(pairs.map((p) => p.ordinal[field]))]),
    ) as Record<OrdinalField, number | null>,
    payoff: {
      meanAbsS: mean(pairs.map((p) => p.payoff.meanAbsS)),
      compared: pairs.reduce((sum, p) => sum + p.payoff.compared, 0),
      oneMissing: pairs.reduce((sum, p) => sum + p.payoff.oneMissing, 0),
    },
    seconds: pairs.reduce((sum, p) => sum + p.seconds, 0),
    videos: Math.max(0, ...pairs.map((p) => p.videos)),
  };
}

export interface GateCheck {
  metric: string;
  value: number | null;
  threshold: number;
  /** Null values (undefined kappa) are reported but do not fail the gate. */
  passed: boolean;
}

/** The spec's thresholds applied to averaged metrics. */
export function gateChecks(metrics: AgreementMetrics): { passed: boolean; checks: GateCheck[] } {
  const check = (metric: string, value: number | null, threshold: number): GateCheck => ({
    metric,
    value,
    threshold,
    passed: value === null || value >= threshold,
  });
  const checks = [
    check("boundary F1 (±3 s)", metrics.boundaryF1, GATE.boundaryF1),
    check("beat_type kappa", metrics.beatTypeKappa, GATE.beatTypeKappa),
    check("framing kappa", metrics.framingKappa, GATE.framingKappa),
    ...ORDINAL_FIELDS.map((field) =>
      check(`${field} weighted kappa`, metrics.ordinal[field], GATE.ordinalKappa),
    ),
  ];
  return { passed: checks.every((c) => c.passed), checks };
}

/** The most frequent disagreements in a label, pooled over every pair of runs. */
export function topConfusions(
  runs: ReadonlyArray<readonly RunExtraction[]>,
  field: "beat_type" | "framing",
  limit = 8,
): Array<{ first: string; second: string; seconds: number }> {
  const counts = new Map<string, number>();
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      const second = new Map((runs[j] ?? []).map((run) => [run.videoId, run]));
      for (const a of runs[i] ?? []) {
        const b = second.get(a.videoId);
        if (!b) continue;
        const duration = Math.min(a.durationS, b.durationS);
        const [x, y] = bothLabelled(
          perSecond(a.beats.beats, duration, (beat) => beat[field]),
          perSecond(b.beats.beats, duration, (beat) => beat[field]),
        );
        if (x.length === 0) continue;
        for (const [label, row] of confusionMatrix(x, y)) {
          for (const [other, n] of row) {
            if (label === other) continue;
            // Order-independent: "context vs setup" and "setup vs context" are one confusion.
            const key = [label, other].sort().join("\u0000");
            counts.set(key, (counts.get(key) ?? 0) + n);
          }
        }
      }
    }
  }
  return [...counts]
    .map(([key, seconds]) => {
      const [first, second] = key.split("\u0000") as [string, string];
      return { first, second, seconds };
    })
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit);
}

/** True when every run returned exactly the same beats for every video. */
export function runsIdentical(runs: ReadonlyArray<readonly RunExtraction[]>): boolean {
  const [first, ...rest] = runs;
  if (!first || rest.length === 0) return false;
  const key = (list: readonly RunExtraction[]) =>
    JSON.stringify(
      [...list]
        .sort((a, b) => a.videoId.localeCompare(b.videoId))
        .map((run) => [run.videoId, run.beats]),
    );
  const reference = key(first);
  return rest.every((run) => key(run) === reference);
}
