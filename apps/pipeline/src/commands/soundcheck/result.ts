import { toFeatureBeatInput } from "@soundcheck/core/features";
import {
  percentileAmong,
  type AudienceMix,
  type CutComparison,
  type CutPrediction,
  type EditSearch,
} from "@soundcheck/core/model";
import {
  AUDIENCE_LABELS,
  type Edit,
  measuredAudienceSchema,
  type MeasuredAudience,
  type Percentiles,
  type Scenario,
  type SoundcheckInputs,
  type SoundcheckPrediction,
  type VideoBeat,
  type VideoBeats,
} from "@soundcheck/core/schemas";
import { modelStamp } from "../publish/assemble";
import { transcriptExcerpt } from "../publish/read";
import type { ChannelModel } from "./channel";

/**
 * A soundcheck's result as the documents store it (Phase 14): pure functions
 * from the extraction and the prediction, rounded the way publish rounds.
 */

const MEASURED = measuredAudienceSchema.options;

const round = (value: number, places: number) => Number(value.toFixed(places));
/** Survival to 4 places; rounding keeps the percentiles in order. */
const curve = (values: ArrayLike<number>) =>
  Array.from(values, (value) => round(Math.min(1, Math.max(0, value)), 4));
const spread = ({ p10, p50, p90 }: Percentiles, places: number): Percentiles => ({
  p10: round(p10, places),
  p50: round(p50, places),
  p90: round(p90, places),
});

/** The beats as the result page shows them, as a video page does. */
export function displayBeats(beats: VideoBeats["beats"]): VideoBeat[] {
  return beats.map((beat) => ({
    startS: beat.start_s,
    endS: beat.end_s,
    beatType: beat.beat_type,
    visual: beat.visual,
    talkingHeadShare: beat.talking_head_share,
    summary: beat.summary,
    transcriptExcerpt: transcriptExcerpt(beat.transcript),
  }));
}

/**
 * The prediction as stored: each audience's band and totals with its model's
 * stamp, the weights (4 places, still summing to 1), the combined totals, and
 * where the combined median falls among the recent videos.
 */
export function predictionDoc(
  prediction: CutPrediction,
  models: Partial<Record<MeasuredAudience, ChannelModel>>,
  recentAvp: readonly number[],
): SoundcheckPrediction {
  const audiences: SoundcheckPrediction["audiences"] = {};
  for (const audience of MEASURED) {
    const predicted = prediction.audiences[audience];
    const model = models[audience];
    if (!predicted || !model) continue;
    audiences[audience] = {
      band: {
        p10: curve(predicted.band.p10),
        p50: curve(predicted.band.p50),
        p90: curve(predicted.band.p90),
      },
      avdS: spread(predicted.avdS, 1),
      avp: spread(predicted.avp, 2),
      model: modelStamp(model.artifact),
    };
  }
  const subscribed = round(prediction.weights.subscribed, 4);
  const percentile = percentileAmong(prediction.avp.p50, recentAvp);
  return {
    audiences,
    weights: { subscribed, unsubscribed: round(1 - subscribed, 4) },
    avdS: spread(prediction.avdS, 1),
    avp: spread(prediction.avp, 2),
    percentileVsChannel: percentile === null ? null : round(percentile, 1),
    comparedVideos: percentile === null ? 0 : recentAvp.length,
  };
}

/** The search's edits as stored: seconds to 0.1, points to 0.01, times to 0.01 s. */
export function editsDoc(edits: EditSearch["edits"]): Edit[] {
  return edits.map((edit) => ({
    editId: edit.id,
    edit: edit.edit,
    startS: round(edit.startS, 2),
    endS: round(edit.endS, 2),
    label: edit.label,
    rationale: edit.rationale,
    deltaAvdS: spread(edit.avdS.delta, 1),
    deltaAvpPp: spread(edit.avp.delta, 2),
    audienceDriver: edit.avdS.driver,
    recommended: edit.recommended,
  }));
}

/** The recommended edits' effect together, as stored; null when none is recommended. */
export function effectDoc(
  together: { avdS: CutComparison; avp: CutComparison } | null,
): { deltaAvdS: Percentiles; deltaAvpPp: Percentiles } | null {
  return together
    ? { deltaAvdS: spread(together.avdS.delta, 1), deltaAvpPp: spread(together.avp.delta, 2) }
    : null;
}

/**
 * One plain sentence about the prediction, from its own numbers (no Gemini):
 * "Newcomers should watch about 38% of this cut (32 to 44%), and subscribers
 * about 46% (40 to 52%). That is better than 67% of your 20 recent videos."
 */
export function narrative(prediction: SoundcheckPrediction): string {
  const parts = MEASURED.flatMap((audience) => {
    const avp = prediction.audiences[audience]?.avp;
    return avp ? [{ label: AUDIENCE_LABELS[audience], avp }] : [];
  });
  const range = ({ p10, p50, p90 }: Percentiles, ofCut: boolean) =>
    `about ${Math.round(p50)}%${ofCut ? " of this cut" : ""} (${Math.round(p10)} to ${Math.round(p90)}%)`;
  const [first, second] = parts;
  let text = "";
  if (first && second) {
    text = `${first.label} should watch ${range(first.avp, true)}, and ${second.label.toLowerCase()} ${range(second.avp, false)}.`;
  } else if (first) {
    text = `${first.label} should watch ${range(first.avp, true)}.`;
  }
  if (prediction.percentileVsChannel !== null) {
    const videos = prediction.comparedVideos === 1 ? "video" : "videos";
    text += ` That is better than ${Math.round(prediction.percentileVsChannel)}% of your ${prediction.comparedVideos} recent ${videos}.`;
  }
  return text.trim();
}

/**
 * The cut as the model reads it, for Phase 15's simulator: no transcript or
 * question text, the channel numbers each model was trained with, the
 * scenario's mix and weights, each model's artifact, and the seed.
 */
export function inputsDoc({
  soundcheckId,
  channelId,
  durationS,
  extraction,
  scenario,
  audienceMix,
  prediction,
  models,
  seed,
  createdAt,
}: {
  soundcheckId: string;
  channelId: string;
  durationS: number;
  extraction: VideoBeats;
  scenario: Scenario;
  audienceMix: AudienceMix;
  prediction: SoundcheckPrediction;
  models: Partial<Record<MeasuredAudience, ChannelModel>>;
  seed: number;
  createdAt: string;
}): SoundcheckInputs {
  const context = (models.unsubscribed ?? models.subscribed)?.artifact.channelContext;
  if (!context) throw new RangeError("A soundcheck needs a channel's model");
  const refs: SoundcheckInputs["models"] = {};
  for (const audience of MEASURED) {
    const model = models[audience];
    const stamp = prediction.audiences[audience]?.model;
    if (model && stamp) {
      refs[audience] = { artifactUri: model.artifactUri, inflation: model.inflation, stamp };
    }
  }
  return {
    soundcheckId,
    channelId,
    durationS,
    video: {
      format: extraction.format,
      targetLevel: extraction.target_level,
      payoffTimeS: extraction.payoff_time_s,
    },
    beats: extraction.beats.map(toFeatureBeatInput),
    channel: { medianTargetLevel: context.medianTargetLevel, mixMean: context.mixMean },
    scenario,
    mix: audienceMix.mix,
    weights: prediction.weights,
    models: refs,
    seed,
    createdAt,
  };
}
