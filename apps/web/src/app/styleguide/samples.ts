import type { AudienceCard, VideoBeat } from "@soundcheck/core/schemas";

/** Made-up data for the style guide: never a real channel's. */

const notUsable = {
  runId: "sample",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 30 are needed"],
  trainedVideos: 3,
};

export const SAMPLE_CARDS: AudienceCard[] = [
  {
    key: "subscribed",
    label: "Subscribers",
    kind: "measured",
    viewShare: 0.31,
    watchTimeShare: 0.38,
    avgViewPct: 52.1,
    traits: [
      {
        feature: "beat_payoff",
        statement: "A 20 s payoff beat at 75%: +3.4 points",
        deltaPp: 3.4,
        ci: [1.2, 5.6],
      },
      {
        feature: "beat_sponsor",
        statement: "A 30 s sponsor read at 30%: -1.8 points",
        deltaPp: -1.8,
        ci: [-3.1, -0.4],
      },
    ],
    effects: [
      { feature: "beat_payoff", label: "A 20 s payoff beat at 75%", deltaPp: 3.4, ci: [1.2, 5.6] },
      {
        feature: "beat_sponsor",
        label: "A 30 s sponsor read at 30%",
        deltaPp: -1.8,
        ci: [-3.1, -0.4],
      },
      { feature: "beat_tangent", label: "A 45 s tangent at 50%", deltaPp: -0.6, ci: [-2.4, 1.1] },
      { feature: "beat_cta", label: "A 15 s call to action at 50%", deltaPp: null, ci: null },
    ],
    description: "Subscribers stay for the payoff and forgive a short sponsor read.",
    model: notUsable,
  },
  {
    key: "unsubscribed",
    label: "Newcomers",
    kind: "measured",
    viewShare: 0.69,
    watchTimeShare: 0.62,
    avgViewPct: 38.4,
    traits: [],
    effects: [
      {
        feature: "beat_sponsor",
        label: "A 30 s sponsor read at 30%",
        deltaPp: -1.1,
        ci: [-2.9, 0.6],
      },
      { feature: "beat_tangent", label: "A 45 s tangent at 50%", deltaPp: 0.3, ci: [-1.2, 1.9] },
    ],
    description: "Newcomers bring 69% of your views and watch 38.4% of a video on average.",
    model: notUsable,
  },
  {
    key: "search",
    label: "Newcomers from search",
    kind: "estimated",
    viewShare: 0.22,
    watchTimeShare: null,
    avgViewPct: null,
    traits: [
      {
        feature: "beat_intro_branding",
        statement: "A 15 s branded intro at the start: -4.2 points",
        deltaPp: -4.2,
        ci: [-6.9, -1.5],
      },
    ],
    effects: [
      {
        feature: "beat_intro_branding",
        label: "A 15 s branded intro at the start",
        deltaPp: -4.2,
        ci: [-6.9, -1.5],
      },
    ],
    description: "Search newcomers want the answer fast and leave during long intros.",
    model: notUsable,
  },
];

export const SAMPLE_EFFECTS = [
  { label: "A 20 s payoff beat at 75%", delta: 3.4, ci: [1.2, 5.6] as const },
  { label: "A 30 s sponsor read at 30%", delta: -1.8, ci: [-3.1, -0.4] as const },
  { label: "A 45 s tangent at 50%", delta: -0.6, ci: [-2.4, 1.1] as const },
  { label: "A 15 s call to action at 50%", delta: null, ci: null },
];

/** A falling curve with a drop at bins 31 to 34, and a band around a smoother median. */
function curve(start: number, decay: number, drop: number): number[] {
  let still = start;
  return Array.from({ length: 100 }, (_, i) => {
    still *= 1 - decay - (i >= 30 && i <= 33 ? drop : 0);
    return Number(still.toFixed(4));
  });
}

export const SAMPLE_SERIES = [
  {
    key: "subscribed" as const,
    label: "Subscribers",
    actual: curve(0.9, 0.006, 0.01),
    band: { p10: curve(0.86, 0.008, 0), p50: curve(0.9, 0.006, 0), p90: curve(0.93, 0.004, 0) },
  },
  {
    key: "unsubscribed" as const,
    label: "Newcomers",
    actual: curve(0.78, 0.011, 0.03),
    band: null,
  },
];

export const SAMPLE_BEATS: VideoBeat[] = [
  {
    startS: 0,
    endS: 8,
    beatType: "hook",
    visual: "none",
    talkingHeadShare: 5,
    summary: "The question.",
    transcriptExcerpt:
      "Have you ever wondered why your videos lose half their viewers in the first minute?",
  },
  {
    startS: 8,
    endS: 20,
    beatType: "intro_branding",
    visual: "graphics",
    talkingHeadShare: 1,
    summary: "The channel intro.",
    transcriptExcerpt: "",
  },
  {
    startS: 20,
    endS: 70,
    beatType: "explanation",
    visual: "none",
    talkingHeadShare: 4,
    summary: "How it works.",
    transcriptExcerpt:
      "Here is what actually happens when someone clicks on your video from search.",
  },
  {
    startS: 70,
    endS: 100,
    beatType: "sponsor",
    visual: "b_roll",
    talkingHeadShare: 3,
    summary: "A sponsor read.",
    transcriptExcerpt:
      "This video is brought to you by a sponsor whose product I genuinely use every day.",
  },
  {
    startS: 100,
    endS: 170,
    beatType: "demonstration",
    visual: "screen_recording",
    talkingHeadShare: 2,
    summary: "The demo.",
    transcriptExcerpt:
      "Let me show you on a real channel, step by step, starting with the retention curve.",
  },
  {
    startS: 170,
    endS: 200,
    beatType: "payoff",
    visual: "none",
    talkingHeadShare: 5,
    summary: "The answer.",
    transcriptExcerpt: "So the answer is simple: get to the point before the twenty second mark.",
  },
  {
    startS: 200,
    endS: 212,
    beatType: "cta",
    visual: "none",
    talkingHeadShare: 5,
    summary: "Subscribe.",
    transcriptExcerpt: "If this helped, subscribe for the next one.",
  },
];

/** Drop-offs on the sample chart: newcomers' sponsor read, and a smaller one for subscribers. */
export const SAMPLE_DROPS = [
  { id: "unsubscribed:31", audience: "unsubscribed" as const, startS: 63.6, endS: 72.1 },
  { id: "subscribed:31", audience: "subscribed" as const, startS: 63.6, endS: 72.1 },
  { id: "unsubscribed:2", audience: "unsubscribed" as const, startS: 2.1, endS: 8.5 },
];
