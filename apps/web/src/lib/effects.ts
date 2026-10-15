import type { Effect, TraitCard } from "@soundcheck/core/schemas";

/**
 * The audiences screen's effects in plain words. Each effect is a "what if"
 * the publish job simulated on a typical video of the channel (the scenarios
 * in packages/core/src/model/effects.ts); its number is the change in how
 * many of every 100 viewers are still watching at the end.
 */

/** A plain name for each effect, and the change Soundcheck tried, by its model feature. */
export const EFFECT_TEXT: Record<string, { name: string; tried: string }> = {
  beat_sponsor: {
    name: "Sponsor reads",
    tried: "Adding a 30-second sponsor read 30% of the way in",
  },
  beat_intro_branding: {
    name: "Branded intros",
    tried: "Adding a 15-second branded intro at the start",
  },
  beat_cta: {
    name: "Calls to action",
    tried: "Adding a 15-second call to action halfway through",
  },
  beat_tangent: {
    name: "Tangents",
    tried: "Adding a 45-second tangent halfway through",
  },
  beat_recap: {
    name: "Recaps",
    tried: "Adding a 30-second recap 70% of the way in",
  },
  beat_payoff: {
    name: "Payoff moments",
    tried: "Adding a 20-second payoff 75% of the way in",
  },
  static_talking_head_share: {
    name: "Long talking-head shots",
    tried: "60 seconds of you talking to a still camera, 40% of the way in",
  },
  visual_b_roll: {
    name: "B-roll",
    tried: "60 seconds of b-roll, 40% of the way in",
  },
  visual_screen_recording: {
    name: "Screen recordings",
    tried: "60 seconds of screen recording, 40% of the way in",
  },
  music_fg: {
    name: "Music up front",
    tried: "30 seconds of music in the foreground, halfway through",
  },
  log1p_cuts_per_min: {
    name: "Faster editing",
    tried: "Twice as many cuts throughout",
  },
  on_screen_text: {
    name: "On-screen text",
    tried: "Text on screen the whole way through",
  },
  energy: {
    name: "Energy",
    tried: "A bit more energy throughout",
  },
  info_density: {
    name: "Packing in information",
    tried: "A bit more information per minute throughout",
  },
  knowledge_gap: {
    name: "Assumed knowledge",
    tried: "Assuming a bit more prior knowledge throughout",
  },
  speech_wpm: {
    name: "Talking speed",
    tried: "Talking 20% faster",
  },
  log1p_secs_in_current_beat: {
    name: "Segment length",
    tried: "Segments half as long",
  },
  has_open_loop: {
    name: "Teasing a question",
    tried: "Raising a question at the start and answering it 75% of the way in",
  },
  before_payoff: {
    name: "Getting to the point",
    tried: "Delivering what the title promises 25% of the way in",
  },
};

/** An effect's plain name and what was tried; an effect this list doesn't know keeps the job's label. */
export function effectText(effect: Pick<Effect, "feature" | "label">): {
  name: string;
  tried: string | null;
} {
  const text = EFFECT_TEXT[effect.feature];
  if (text) return text;
  return { name: effect.label.charAt(0).toUpperCase() + effect.label.slice(1), tried: null };
}

/**
 * What an effect says: it keeps viewers or loses them (its whole range is on
 * one side of zero), it may do either (`unclear`), or the channel's videos
 * never had it, so the model could not learn it (`absent`).
 */
export type Verdict = "keeps" | "loses" | "unclear" | "absent";

export function verdictOf(effect: Pick<Effect, "deltaPp" | "ci">): Verdict {
  if (effect.deltaPp === null || effect.ci === null) return "absent";
  if (effect.ci[0] > 0) return "keeps";
  if (effect.ci[1] < 0) return "loses";
  return "unclear";
}

/** Viewers out of 100: whole numbers from 1, one decimal below it ("0.4"). */
function viewers(value: number): string {
  const size = Math.abs(value);
  return size >= 1 ? String(Math.round(size)) : size.toFixed(1);
}

/** The middle of a clear effect, out of 100: "about 3 more" or "under 1 fewer". */
function amount(deltaPp: number): { words: string; one: boolean } {
  const more = deltaPp > 0 ? "more" : "fewer";
  return Math.abs(deltaPp) < 1
    ? { words: `under 1 ${more}`, one: true }
    : { words: `about ${Math.round(Math.abs(deltaPp))} ${more}`, one: false };
}

/**
 * A clear effect as a sentence: "About 3 more of every 100 viewers stay to the
 * end (between 1 and 6)." Null for an effect that is not clear.
 */
export function effectSentence(effect: Pick<Effect, "deltaPp" | "ci">): string | null {
  const verdict = verdictOf(effect);
  if ((verdict !== "keeps" && verdict !== "loses") || effect.deltaPp === null || !effect.ci) {
    return null;
  }
  const { words, one } = amount(effect.deltaPp);
  const [low, high] = [Math.abs(effect.ci[0]), Math.abs(effect.ci[1])].sort((a, b) => a - b);
  const sentence = `${words.charAt(0).toUpperCase()}${words.slice(1)} of every 100 viewers ${one ? "stays" : "stay"} to the end`;
  return `${sentence} (between ${viewers(low as number)} and ${viewers(high as number)}).`;
}

/** A clear trait for an audience card: "about 3 more in 100 stay". */
export function traitLine(trait: Pick<TraitCard, "deltaPp">): string {
  const { words, one } = amount(trait.deltaPp);
  return `${words} in 100 ${one ? "stays" : "stay"}`;
}

/** An audience's effects by what they say, each group in the order given. */
export function groupEffects<T extends Pick<Effect, "deltaPp" | "ci">>(
  effects: readonly T[],
): Record<Verdict, T[]> {
  const groups: Record<Verdict, T[]> = { keeps: [], loses: [], unclear: [], absent: [] };
  for (const effect of effects) groups[verdictOf(effect)].push(effect);
  return groups;
}
