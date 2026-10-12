import type { AttributionGroup, Drop, VideoDoc } from "@soundcheck/core/schemas";
import type { ChartDrop, ChartSeries } from "@/components/retention-chart";
import { formatClock } from "./format";

/**
 * The audiences screen's effect each attribution group links to (the effect
 * keyed by the scenario's first feature). Position in the video is not
 * something to edit, so it links nowhere.
 */
export const GROUP_EFFECT: Partial<Record<AttributionGroup, string>> = {
  sponsor: "beat_sponsor",
  branded_intro: "beat_intro_branding",
  call_to_action: "beat_cta",
  tangent: "beat_tangent",
  recap: "beat_recap",
  payoff: "beat_payoff",
  no_visual_change: "static_talking_head_share",
  visuals: "visual_b_roll",
  on_screen_text: "on_screen_text",
  energy: "energy",
  pace: "info_density",
  knowledge_gap: "knowledge_gap",
  long_beat: "log1p_secs_in_current_beat",
  music: "music_fg",
};

/** Each cause as the drop panel's sentence names it: "links 13% of this drop to …". */
const CAUSE_PHRASE: Record<AttributionGroup, string> = {
  sponsor: "the sponsor segment",
  branded_intro: "the branded intro",
  call_to_action: "a call to action",
  tangent: "a tangent",
  recap: "a recap",
  payoff: "waiting for the payoff",
  no_visual_change: "nothing changing on screen",
  visuals: "what's on screen",
  on_screen_text: "on-screen text",
  energy: "the delivery's energy",
  pace: "the pace of information",
  knowledge_gap: "a knowledge gap",
  long_beat: "one beat running long",
  music: "foreground music",
  position: "its position in the video",
};

/** What each cause means, in the note behind its chip's "?", from the features it groups. */
export const CAUSE_NOTE: Record<AttributionGroup, string> = {
  sponsor: "A sponsor read or paid promotion is playing.",
  branded_intro: "A channel intro, logo or title sequence is playing.",
  call_to_action: "You're asking viewers to like, subscribe or do something else.",
  tangent: "The video has wandered off its main topic.",
  recap: "The video is summing up or repeating what it already said.",
  payoff:
    "Viewers are still waiting for what the title or opening promised, or for the answer to a question the video raised.",
  no_visual_change: "The picture stays on one shot of someone talking, with few or no cuts.",
  visuals:
    "What the picture shows when it isn't someone to camera, such as b-roll or a screen recording.",
  on_screen_text: "Text is shown over the picture.",
  energy: "How lively the delivery is.",
  pace: "How quickly new information arrives, and how fast the speaking is.",
  knowledge_gap: "This part assumes more, or less, knowledge than your videos usually do.",
  long_beat: "The video has stayed on one section for a long time.",
  music: "Music is in the foreground, not just behind speech.",
  position:
    "Viewers leave faster at the start and the end of every video. This is the part of the drop expected just from when it happens, whatever is on screen.",
};

/** The note behind the unexplained chip's "?". */
export const UNEXPLAINED_NOTE =
  "The part of the drop the model can't link to anything it measures. It usually shrinks as the model learns from more of your videos.";

const list = new Intl.ListFormat("en-GB", { type: "conjunction" });

const AUDIENCE = { subscribed: "Subscribers", unsubscribed: "Newcomers" } as const;
const LOWER = { subscribed: "subscribers", unsubscribed: "newcomers" } as const;

/** A drop's stable ID on the page: its audience and first bin. */
export const dropId = (drop: Pick<Drop, "audience" | "binStart">) =>
  `${drop.audience}:${drop.binStart}`;

/** The drop panel's title: "Why 41.9% of newcomers left at 0:03". */
export const dropTitle = (drop: Drop) =>
  `Why ${drop.actualLossPp.toFixed(1)}% of ${LOWER[drop.audience]} left at ${formatClock(drop.startS)}`;

/** A share as the chips show it: a whole percent. */
export const sharePercent = (share: number) => `${Math.round(share * 100)}%`;

/**
 * The drop panel's answer in plain words, from the chips' own numbers (not
 * Gemini, so it is always there): "The model links 13% of this drop to its
 * position in the video and 3% to waiting for the payoff. It can't explain
 * the other 84%."
 */
export function dropReason(drop: Pick<Drop, "attributions" | "residualShare">): string {
  if (!drop.attributions.length) return "The model can't explain this drop yet.";
  const causes = drop.attributions.map(
    (a, i) =>
      `${sharePercent(a.share)}${i === 0 ? " of this drop" : ""} to ${CAUSE_PHRASE[a.group]}`,
  );
  const rest =
    Math.round(drop.residualShare * 100) > 0
      ? ` It can't explain the other ${sharePercent(drop.residualShare)}.`
      : "";
  return `The model links ${list.format(causes)}.${rest}`;
}

/** Where an attribution chip links: the audience's sheet, open at the related effect. */
export function effectLink(drop: Pick<Drop, "audience">, group: AttributionGroup): string | null {
  const effect = GROUP_EFFECT[group];
  return effect ? `/app/audiences?audience=${drop.audience}&effect=${effect}` : null;
}

/** The video's drop-off to show first: its largest. */
export function firstDrop(drops: readonly Drop[]): Drop | null {
  return drops.reduce<Drop | null>(
    (largest, drop) => (!largest || drop.actualLossPp > largest.actualLossPp ? drop : largest),
    null,
  );
}

/** The chart's series and drop windows from a video's page document. */
export function chartData(video: VideoDoc): { series: ChartSeries[]; drops: ChartDrop[] } {
  const series = (["subscribed", "unsubscribed"] as const).flatMap((key) => {
    const audience = video.audiences[key];
    return audience && (audience.actual || audience.predicted)
      ? [{ key, label: AUDIENCE[key], actual: audience.actual, band: audience.predicted }]
      : [];
  });
  const drops = video.drops.map((drop) => ({
    id: dropId(drop),
    audience: drop.audience,
    startS: drop.startS,
    endS: drop.endS,
  }));
  return { series, drops };
}
