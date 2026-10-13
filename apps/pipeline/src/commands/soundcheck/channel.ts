import { RECENT_VIDEOS, type RecentVideo } from "@soundcheck/core/model";
import {
  measuredAudienceSchema,
  type MeasuredAudience,
  type ModelArtifact,
} from "@soundcheck/core/schemas";
import { holdoutResults, videoStats } from "../publish/assemble";
import { readPublishInputs, type PublishInputs } from "../publish/read";

/** An audience's latest fitted model, where it is stored, and its band calibration. */
export interface ChannelModel {
  artifact: ModelArtifact;
  artifactUri: string;
  /** The held-out evaluation's factor for this model; 1 without one. */
  inflation: number;
}

/** What a soundcheck needs from its channel. */
export interface ChannelForCut {
  models: Partial<Record<MeasuredAudience, ChannelModel>>;
  /** The newest eligible videos, at most `RECENT_VIDEOS`: their newcomer mix and views. */
  recent: RecentVideo[];
  /** YouTube's average view percentage of each recent video that has one. */
  recentAvp: number[];
}

/**
 * The channel's side of a soundcheck, from what publish reads: the same
 * models, calibration and statistics the screens show, so a soundcheck and
 * the video pages never disagree about the channel.
 */
export function channelForCut(inputs: PublishInputs): ChannelForCut {
  const { inflation } = holdoutResults(inputs);
  const models: Partial<Record<MeasuredAudience, ChannelModel>> = {};
  for (const audience of measuredAudienceSchema.options) {
    const artifact = inputs.models.get(audience);
    const artifactUri = inputs.modelUris.get(audience);
    if (artifact && artifactUri) {
      models[audience] = { artifact, artifactUri, inflation: inflation[audience] ?? 1 };
    }
  }
  const newest = inputs.videos.slice(0, RECENT_VIDEOS);
  return {
    models,
    recent: newest.map((video) => ({
      mix: inputs.features.newcomerMix.get(video.videoId) ?? null,
      views: inputs.features.views.get(video.videoId) ?? { subscribed: 0, unsubscribed: 0 },
    })),
    recentAvp: newest.flatMap((video) => {
      const stats = videoStats(inputs.stats.get(video.videoId), video.durationS);
      return stats ? [stats.avp] : [];
    }),
  };
}

export async function readChannelForCut(channelId: string): Promise<ChannelForCut> {
  return channelForCut(await readPublishInputs(channelId));
}
