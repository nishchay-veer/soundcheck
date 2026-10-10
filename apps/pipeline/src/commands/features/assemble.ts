import { EXTRACTION_VERSION, FEATURE_VERSION } from "@soundcheck/core";
import {
  buildBins,
  channelContext,
  frameRow,
  type ChannelContext,
  type TrafficMix,
} from "@soundcheck/core/features";
import {
  trainingAudienceSchema,
  trainingBinRowSchema,
  type TrainingAudience,
  type TrainingBinRow,
} from "@soundcheck/core/schemas";
import type { FeatureInputs } from "./inputs";

export const TRAINING_AUDIENCES = trainingAudienceSchema.options;

export interface TrainingBins {
  rows: TrainingBinRow[];
  /** Null when no video is usable. */
  context: ChannelContext | null;
  /** Videos with rows. */
  used: string[];
  skipped: Array<{ videoId: string; reason: string }>;
  /** Used videos without a newcomer mix, given the channel mean instead. */
  missingMix: string[];
  rowsByAudience: Record<TrainingAudience, number>;
  /** The latest data date of the curves used; null without rows. */
  asOf: string | null;
}

/**
 * The `training_bins` rows of a channel: for each usable video and audience,
 * the 100 bins joined to the measured hazards by bin index. A video is usable
 * when it is eligible for training, has beats from the current extraction and
 * has at least one complete curve. `n_at_risk` is the audience's views times
 * survival before the bin (`s_mono` of the previous bin, 1 before bin 1).
 */
export function assembleTrainingBins(channelId: string, inputs: FeatureInputs): TrainingBins {
  const skipped: TrainingBins["skipped"] = [];
  const usable = inputs.videos.flatMap((video) => {
    const extraction = inputs.extractions.get(video.videoId);
    const curves = inputs.curves.get(video.videoId);
    let reason: string | null = null;
    if (!video.eligible) reason = "not eligible for training";
    else if (!extraction) reason = `no ${EXTRACTION_VERSION} beats`;
    else if (!curves || curves.size === 0) reason = "no complete retention curve";
    if (reason !== null || !extraction || !curves) {
      skipped.push({ videoId: video.videoId, reason: reason ?? "" });
      return [];
    }
    return [{ ...video, extraction, curves, mix: inputs.newcomerMix.get(video.videoId) ?? null }];
  });

  const rowsByAudience: Record<TrainingAudience, number> = {
    all: 0,
    subscribed: 0,
    unsubscribed: 0,
  };
  if (usable.length === 0) {
    return {
      rows: [],
      context: null,
      used: [],
      skipped,
      missingMix: [],
      rowsByAudience,
      asOf: null,
    };
  }

  const context = channelContext(
    usable.map((video) => video.extraction.target_level),
    usable.flatMap((video) => (video.mix ? [video.mix] : [])),
  );
  const rows: TrainingBinRow[] = [];
  let asOf: string | null = null;
  for (const video of usable) {
    // Without a reported mix, the channel mean: centered at 0, so no mix effect.
    const mix: TrafficMix = video.mix ?? context.mixMean;
    const newcomers = buildBins(video.extraction, video.durationS, context, mix);
    const others = buildBins(video.extraction, video.durationS, context, null);
    const views = inputs.views.get(video.videoId) ?? { subscribed: 0, unsubscribed: 0 };
    const audienceViews: Record<TrainingAudience, number> = {
      all: views.subscribed + views.unsubscribed,
      subscribed: views.subscribed,
      unsubscribed: views.unsubscribed,
    };
    for (const audience of TRAINING_AUDIENCES) {
      const curve = video.curves.get(audience);
      if (!curve) continue;
      const frame = audience === "unsubscribed" ? newcomers : others;
      curve.forEach((point, index) => {
        const survivalBefore = index === 0 ? 1 : (curve[index - 1]?.sMono ?? 1);
        rows.push(
          trainingBinRowSchema.parse({
            channel_id: channelId,
            video_id: video.videoId,
            audience,
            bin: point.bin,
            hazard: point.hazard,
            n_at_risk: audienceViews[audience] * survivalBefore,
            video_views: audienceViews[audience],
            feature_version: FEATURE_VERSION,
            extraction_version: EXTRACTION_VERSION,
            as_of: point.asOf,
            x: frameRow(frame, index),
          }),
        );
        if (asOf === null || point.asOf > asOf) asOf = point.asOf;
      });
      rowsByAudience[audience] += curve.length;
    }
  }
  return {
    rows,
    context,
    used: usable.map((video) => video.videoId),
    skipped,
    missingMix: usable.filter((video) => !video.mix).map((video) => video.videoId),
    rowsByAudience,
    asOf,
  };
}
