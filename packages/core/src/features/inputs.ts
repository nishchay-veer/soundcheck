import type { FeatureBeatInput } from "../schemas";
import { opensLoop, speaks, type FeatureBeat } from "./timeline";

/**
 * A soundcheck's stored beats (Phase 14) and the featurizer's beats. The
 * stored form keeps what the features read and drops the text: features only
 * ask whether a beat says anything and whether it opens a question, so
 * placeholders stand in for the transcript and the question. The round trip
 * builds identical bins (inputs.test.ts).
 */

/** Stand-ins for text the stored form does not keep. */
const SPEECH = "(speech)";
const QUESTION = "(an open question)";

export function toFeatureBeatInput(beat: FeatureBeat): FeatureBeatInput {
  return {
    startS: beat.start_s,
    endS: beat.end_s,
    beatType: beat.beat_type,
    talkingHeadShare: beat.talking_head_share,
    visual: beat.visual,
    cutsPerMin: beat.cuts_per_min,
    onScreenText: beat.on_screen_text,
    music: beat.music,
    energy: beat.energy,
    assumedKnowledge: beat.assumed_knowledge,
    infoDensity: beat.info_density,
    opensLoop: opensLoop(beat),
    closesLoop: beat.closes_loop,
    speaks: speaks(beat),
    wordsPerMinute: beat.words_per_minute,
  };
}

export function toFeatureBeat(input: FeatureBeatInput): FeatureBeat {
  return {
    start_s: input.startS,
    end_s: input.endS,
    beat_type: input.beatType,
    talking_head_share: input.talkingHeadShare,
    visual: input.visual,
    cuts_per_min: input.cutsPerMin,
    on_screen_text: input.onScreenText,
    music: input.music,
    energy: input.energy,
    assumed_knowledge: input.assumedKnowledge,
    info_density: input.infoDensity,
    opens_loop: input.opensLoop ? QUESTION : null,
    closes_loop: input.closesLoop,
    transcript: input.speaks ? SPEECH : "",
    words_per_minute: input.wordsPerMinute,
  };
}
