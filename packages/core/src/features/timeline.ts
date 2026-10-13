import type { Beat, VideoBeats } from "../schemas";
import {
  BINS,
  FEATURE_NAMES,
  FEATURE_SPEC,
  INTERACTION_FEATURES,
  MIX_BUCKETS,
  POSITION_KNOTS,
  POSITION_SPLINE,
  STATIC_TALKING_HEAD,
  featureIndex,
  type MixBucket,
} from "./spec";
import { bsplineBasis } from "./spline";

/**
 * The 100-bin timeline: one feature vector per bin, in `FEATURE_SPEC` order.
 * Bin i (from 0) covers `[i / 100 * D, (i + 1) / 100 * D)`, so bins are
 * relative: 24 s each in a 40-minute video, 3 s in a 5-minute one. Every
 * beat feature is weighted by how much of the bin the beat covers. The same
 * code builds training rows (Phase 07) and the frames predictions run on.
 */

/** The parts of a beat the features use; a stored `Beat` qualifies. */
export type FeatureBeat = Pick<
  Beat,
  | "start_s"
  | "end_s"
  | "beat_type"
  | "talking_head_share"
  | "visual"
  | "cuts_per_min"
  | "on_screen_text"
  | "music"
  | "energy"
  | "assumed_knowledge"
  | "info_density"
  | "opens_loop"
  | "closes_loop"
  | "transcript"
  | "words_per_minute"
>;

/** The parts of an extraction the features use; a stored `VideoBeats` qualifies. */
export interface FeatureVideo extends Pick<
  VideoBeats,
  "format" | "target_level" | "payoff_time_s"
> {
  beats: readonly FeatureBeat[];
}

/** Shares of newcomer views by traffic source, each 0 to 1. */
export type TrafficMix = Readonly<Record<MixBucket, number>>;

/** Channel-level values that features are measured against. */
export interface ChannelContext {
  /** Median `target_level` of the channel's extracted videos. */
  medianTargetLevel: number;
  /** Mean newcomer traffic mix over the channel's training videos; mix features are centered on it. */
  mixMean: TrafficMix;
}

export interface FeatureFrame {
  /** One row per bin: always `BINS`. */
  rows: number;
  /** `FEATURE_NAMES`, one per column. */
  columns: readonly string[];
  /** Column-major: feature `j` in bin `i` (both from 0) is `values[j * rows + i]`. */
  values: Float64Array;
}

/** A beat stretched to its share of the timeline. */
export interface Segment {
  beat: FeatureBeat;
  start: number;
  end: number;
  /** A person to camera throughout with almost no cuts. */
  static: boolean;
}

const isStatic = (beat: FeatureBeat) =>
  beat.talking_head_share >= STATIC_TALKING_HEAD.minTalkingHeadShare &&
  beat.cuts_per_min <= STATIC_TALKING_HEAD.maxCutsPerMin;

/**
 * The beats that start inside the video, stretched to tile `[0, D]` exactly:
 * a gap or overlap between neighbours splits at its midpoint, the first beat
 * starts at 0 and the last ends at D. The validator allows up to 5% of a video
 * uncovered; this gives that time to the nearest beat, so shares sum to 1.
 */
export function tileBeats(beats: readonly FeatureBeat[], durationS: number): Segment[] {
  const inside = beats
    .filter((beat) => beat.start_s < durationS)
    .sort((a, b) => a.start_s - b.start_s);
  if (inside.length === 0) throw new RangeError("No beat starts inside the video");
  const segments: Segment[] = [];
  let start = 0;
  inside.forEach((beat, index) => {
    const next = inside[index + 1];
    const end = next
      ? Math.max(start, Math.min(durationS, (beat.end_s + next.start_s) / 2))
      : durationS;
    if (end > start) segments.push({ beat, start, end, static: isStatic(beat) });
    start = end;
  });
  return segments;
}

/** The median of a non-empty list. */
function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError("The median needs at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The channel context from its videos' target levels and newcomer mixes. */
export function channelContext(
  targetLevels: readonly number[],
  mixes: readonly TrafficMix[],
): ChannelContext {
  const mean = (bucket: MixBucket) =>
    mixes.length === 0 ? 0 : mixes.reduce((sum, mix) => sum + mix[bucket], 0) / mixes.length;
  return {
    medianTargetLevel: median(targetLevels),
    mixMean: { search: mean("search"), suggested: mean("suggested"), browse: mean("browse") },
  };
}

/** Whether a beat raises a question or promise the video answers later. */
export const opensLoop = (beat: Pick<FeatureBeat, "opens_loop">) =>
  beat.opens_loop !== null && beat.opens_loop.trim() !== "";

/** Whether anything is said in a beat; a beat with no speech counts as silence. */
export const speaks = (beat: Pick<FeatureBeat, "transcript">) => beat.transcript.trim() !== "";

/**
 * The feature frame of one video for one audience: 100 rows by
 * `FEATURE_SPEC.length` columns. `mix` is the newcomer traffic mix and only
 * applies to newcomer rows; pass null for subscribers and all viewers, which
 * leaves the mix and interaction columns at 0.
 */
export function buildBins(
  video: FeatureVideo,
  durationS: number,
  channel: ChannelContext,
  mix: TrafficMix | null,
): FeatureFrame {
  if (!(Number.isFinite(durationS) && durationS > 0)) {
    throw new RangeError(`Duration must be a positive number of seconds, got ${durationS}`);
  }
  if (mix && MIX_BUCKETS.some((bucket) => !(mix[bucket] >= 0 && mix[bucket] <= 1))) {
    throw new RangeError(`Traffic shares must lie within [0, 1]: ${JSON.stringify(mix)}`);
  }
  const segments = tileBeats(video.beats, durationS);
  const columns = FEATURE_NAMES.length;
  const values = new Float64Array(BINS * columns);
  const binSeconds = durationS / BINS;
  let previousEnergy: number | null = null;

  for (let bin = 0; bin < BINS; bin += 1) {
    const row = new Float64Array(columns);
    const set = (name: string, value: number) => (row[featureIndex(name)] = value);
    const add = (name: string, value: number) => {
      const index = featureIndex(name);
      row[index] = (row[index] as number) + value;
    };
    const low = (bin / BINS) * durationS;
    const high = ((bin + 1) / BINS) * durationS;
    const middle = ((bin + 0.5) / BINS) * durationS;

    // Overlap-weighted shares and means.
    let cuts = 0;
    for (const segment of segments) {
      const overlap = Math.min(segment.end, high) - Math.max(segment.start, low);
      if (overlap <= 0) continue;
      const weight = overlap / (high - low);
      const beat = segment.beat;
      add(`beat_${beat.beat_type}`, weight);
      add(`visual_${beat.visual}`, weight);
      add("talking_head_share", weight * beat.talking_head_share);
      if (segment.static) add("static_talking_head_share", weight);
      cuts += weight * beat.cuts_per_min;
      if (beat.on_screen_text) add("on_screen_text", weight);
      if (beat.music === "background") add("music_bg", weight);
      if (beat.music === "foreground") add("music_fg", weight);
      if (!speaks(beat)) add("silence", weight);
      add("energy", weight * beat.energy);
      add("assumed_knowledge", weight * beat.assumed_knowledge);
      add("info_density", weight * beat.info_density);
      add("speech_wpm", weight * beat.words_per_minute);
    }
    set("log1p_cuts_per_min", Math.log1p(cuts));

    // At the bin midpoint.
    const found = segments.findIndex(({ start, end }) => start <= middle && middle < end);
    const at = found === -1 ? segments.length - 1 : found;
    const segment = segments[at] as Segment;
    set("log1p_secs_in_current_beat", Math.log1p(middle - segment.start));
    let runStart = segment.start;
    for (let k = at; k >= 0 && (segments[k] as Segment).static; k -= 1) {
      runStart = (segments[k] as Segment).start;
    }
    set("log1p_static_run_s", segment.static ? Math.log1p(middle - runStart) : 0);
    let open = 0;
    for (const { beat, start } of segments) {
      if (start > middle) break;
      if (beat.closes_loop && open > 0) open -= 1;
      if (opensLoop(beat)) open += 1;
    }
    set("has_open_loop", open > 0 ? 1 : 0);
    set("before_payoff", video.payoff_time_s !== null && middle < video.payoff_time_s ? 1 : 0);

    const energy = row[featureIndex("energy")] as number;
    set("energy_delta", previousEnergy === null ? 0 : energy - previousEnergy);
    previousEnergy = energy;
    set(
      "knowledge_gap",
      (row[featureIndex("assumed_knowledge")] as number) - channel.medianTargetLevel,
    );

    // Position and video level.
    set("is_first_bin", bin === 0 ? 1 : 0);
    set("log_bin_seconds", Math.log(binSeconds));
    bsplineBasis((bin + 0.5) / BINS, POSITION_KNOTS, POSITION_SPLINE.degree)
      .filter((_, index) => index !== POSITION_SPLINE.droppedBasis)
      .forEach((value, index) => set(`pos_b${index + 1}`, value));
    set(`format_${video.format}`, 1);
    set("target_level", video.target_level);

    // Clip, then build the mix and interaction columns from clipped values.
    FEATURE_SPEC.forEach(({ clip }, index) => {
      if (clip) row[index] = Math.min(clip[1], Math.max(clip[0], row[index] as number));
    });
    if (mix) {
      for (const bucket of MIX_BUCKETS) {
        const centered = mix[bucket] - channel.mixMean[bucket];
        set(`mix_${bucket}`, centered);
        for (const feature of INTERACTION_FEATURES) {
          set(`ix_${feature}_${bucket}`, (row[featureIndex(feature)] as number) * centered);
        }
      }
    }

    row.forEach((value, index) => {
      if (!Number.isFinite(value)) {
        throw new RangeError(`${FEATURE_NAMES[index]} is not finite in bin ${bin + 1}: ${value}`);
      }
      values[index * BINS + bin] = value;
    });
  }
  return { rows: BINS, columns: FEATURE_NAMES, values };
}

/** One feature's values across the bins. */
export function frameColumn(frame: FeatureFrame, name: string): Float64Array {
  const index = frame.columns.indexOf(name);
  if (index === -1) throw new RangeError(`Unknown feature: ${name}`);
  return frame.values.subarray(index * frame.rows, (index + 1) * frame.rows);
}

/** The feature vector of one bin (from 0), in column order. */
export function frameRow(frame: FeatureFrame, bin: number): number[] {
  if (!Number.isInteger(bin) || bin < 0 || bin >= frame.rows) {
    throw new RangeError(`Bin ${bin} is outside 0 to ${frame.rows - 1}`);
  }
  return frame.columns.map((_, index) => frame.values[index * frame.rows + bin] as number);
}
