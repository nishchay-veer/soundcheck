import { FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import { latestFittedModels, readModelArtifact } from "@soundcheck/core/jobs";
import {
  TRAIT_INTERVAL,
  estimatedAudiences,
  traits,
  type EstimatedAudience,
  type Trait,
} from "@soundcheck/core/model";
import type { ModelArtifact, TrainingAudience } from "@soundcheck/core/schemas";
import { readFeatureInputs } from "../features/inputs";

export interface AudienceTraits {
  audience: TrainingAudience;
  runId: string;
  usable: boolean;
  unusableReasons: string[];
  traits: Trait[];
}

export interface TraitsResult {
  channelId: string;
  /** The training video of median length the scenarios edit. */
  video: { id: string; durationS: number; outOf: number };
  audiences: AudienceTraits[];
  /** From the newcomer model; empty without one. */
  estimated: EstimatedAudience[];
}

/**
 * `soundcheck traits`: each audience's traits from the channel's latest
 * fitted models (usable or not, so a person can sanity-read them), simulated
 * on the training video of median length. Newcomer traits use the channel's
 * mean traffic mix: a typical newcomer.
 */
export async function buildTraits({
  channelId,
  draws = 200,
  seed = 1,
}: {
  channelId: string;
  draws?: number;
  seed?: number;
}): Promise<TraitsResult> {
  const fitted = await latestFittedModels(channelId, {
    modelVersion: MODEL_VERSION,
    featureVersion: FEATURE_VERSION,
  });
  if (fitted.size === 0) {
    throw new Error(
      `No fitted ${MODEL_VERSION} models on ${FEATURE_VERSION} for ${channelId}: run "soundcheck-modeling fit --channel ${channelId}" first`,
    );
  }
  const models: ModelArtifact[] = [];
  for (const model of fitted.values()) models.push(await readModelArtifact(model.artifactUri));

  const inputs = await readFeatureInputs(channelId);
  const trained = new Set(models.flatMap((model) => model.trainVideoIds));
  const candidates = inputs.videos
    .filter((video) => trained.has(video.videoId) && inputs.extractions.has(video.videoId))
    .sort((a, b) => a.durationS - b.durationS || a.videoId.localeCompare(b.videoId));
  const typical = candidates[Math.floor((candidates.length - 1) / 2)];
  const extraction = typical && inputs.extractions.get(typical.videoId);
  if (!typical || !extraction) {
    throw new Error(`None of the models' training videos has current beats for ${channelId}`);
  }

  const order: TrainingAudience[] = ["all", "subscribed", "unsubscribed"];
  const options = { draws, seed };
  const audiences = order.flatMap((audience) => {
    const model = models.find((m) => m.audience === audience);
    if (!model?.channelContext) return [];
    const mix = audience === "unsubscribed" ? model.channelContext.mixMean : null;
    return [
      {
        audience,
        runId: model.runId,
        usable: model.usable,
        unusableReasons: model.unusableReasons,
        traits: traits(model, extraction, typical.durationS, mix, options),
      },
    ];
  });
  const newcomers = models.find((m) => m.audience === "unsubscribed");
  return {
    channelId,
    video: { id: typical.videoId, durationS: typical.durationS, outOf: candidates.length },
    audiences,
    estimated: newcomers
      ? estimatedAudiences(newcomers, extraction, typical.durationS, options)
      : [],
  };
}

const AUDIENCE_NAMES: Record<TrainingAudience, string> = {
  all: "All viewers",
  subscribed: "Subscribers",
  unsubscribed: "Newcomers",
};

const pp = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;

function traitLine(trait: Trait): string {
  const result =
    trait.measured && trait.deltaPp !== null && trait.ciLow !== null && trait.ciHigh !== null
      ? `${pp(trait.deltaPp)} pp (${pp(trait.ciLow)} to ${pp(trait.ciHigh)})`
      : "not learned: it never varies in the training videos";
  return `    ${trait.condition.padEnd(52)} ${result}`;
}

/** The traits list for the terminal and the notes. */
export function formatTraits(result: TraitsResult): string {
  const interval = Math.round((TRAIT_INTERVAL[1] - TRAIT_INTERVAL[0]) * 100);
  const lines = [
    `Traits for ${result.channelId} (${MODEL_VERSION} on ${FEATURE_VERSION})`,
    `  Simulated on ${result.video.id} (${result.video.durationS} s), the median length of ${result.video.outOf} training videos.`,
    `  Change in viewers still watching at the end, with a ${interval}% interval. Associations in past videos, not causes.`,
  ];
  for (const audience of result.audiences) {
    lines.push(
      "",
      `  ${AUDIENCE_NAMES[audience.audience]} (run ${audience.runId.slice(0, 8)}${
        audience.usable ? "" : `; not usable: ${audience.unusableReasons.join("; ")}`
      })`,
      ...audience.traits.map(traitLine),
    );
  }
  if (result.estimated.length > 0) {
    lines.push("", "  Estimated audiences, from the newcomer model:");
    for (const estimated of result.estimated) {
      lines.push(
        `    ${estimated.source}: ${estimated.shown ? "shown" : `hidden (${estimated.reasons.join("; ")})`}`,
      );
    }
  }
  return lines.join("\n");
}
