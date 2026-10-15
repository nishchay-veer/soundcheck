import type { AudienceCard, Edit, SoundcheckDoc, VideoBeat } from "@soundcheck/core/schemas";

/** Made-up data for the style guide: never a real channel's. */

const notUsable = {
  runId: "sample",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 20 are needed"],
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

const predicted = (low: number[], middle: number[], high: number[]) => ({
  p10: low,
  p50: middle,
  p90: high,
});

/** A suggested edit for the sample soundcheck. */
function sampleEdit(
  editId: string,
  edit: Edit["edit"],
  startS: number,
  endS: number,
  label: string,
  rationale: string,
  seconds: [number, number, number],
  points: [number, number, number],
): Edit {
  return {
    editId,
    edit,
    startS,
    endS,
    label,
    rationale,
    deltaAvdS: { p10: seconds[0], p50: seconds[1], p90: seconds[2] },
    deltaAvpPp: { p10: points[0], p50: points[1], p90: points[2] },
    audienceDriver: "unsubscribed",
    recommended: false,
  };
}

/** A finished soundcheck of an uploaded cut, 3:32 long. */
export const SAMPLE_SOUNDCHECK: SoundcheckDoc = {
  soundcheckId: "0123456789abcdef0123456789abcdef",
  channelId: "UCaBcDeFgHiJkLmNoPqRsTuV",
  status: "ready",
  title: "How I built a guitar in a weekend",
  scenario: "search",
  input: {
    kind: "file",
    fileName: "guitar rough cut v3.mov",
    contentType: "video/quicktime",
    sizeBytes: 912_000_000,
    uri: "gs://sample-uploads/UCaBcDeFgHiJkLmNoPqRsTuV/0123456789abcdef0123456789abcdef/source.mov",
  },
  progress: { step: "finishing", message: "Done", done: 5, total: 5 },
  error: null,
  durationS: 212,
  beats: SAMPLE_BEATS,
  prediction: {
    audiences: {
      subscribed: {
        band: predicted(curve(0.86, 0.008, 0), curve(0.9, 0.006, 0), curve(0.93, 0.004, 0)),
        avdS: { p10: 98, p50: 112, p90: 125 },
        avp: { p10: 46.2, p50: 52.8, p90: 59 },
        model: notUsable,
      },
      unsubscribed: {
        band: predicted(curve(0.7, 0.013, 0), curve(0.76, 0.011, 0), curve(0.8, 0.009, 0)),
        avdS: { p10: 61, p50: 74, p90: 88 },
        avp: { p10: 28.8, p50: 34.9, p90: 41.5 },
        model: notUsable,
      },
    },
    weights: { subscribed: 0.2, unsubscribed: 0.8 },
    avdS: { p10: 70, p50: 82, p90: 95 },
    avp: { p10: 33, p50: 38.5, p90: 44.9 },
    percentileVsChannel: 66.7,
    comparedVideos: 3,
  },
  edits: [
    sampleEdit(
      "move-3-to-5",
      { op: "move", beat: 3, to: 5 },
      70,
      100,
      "Move the sponsor read at 1:10 to 2:20",
      "Later in the video, it reaches viewers who are already hooked.",
      [3.1, 6.4, 9.8],
      [1.4, 3, 4.6],
    ),
    sampleEdit(
      "move-5-to-2",
      { op: "move", beat: 5, to: 2 },
      170,
      200,
      "Move the payoff at 2:50 to 0:20",
      "Delivering the payoff sooner cuts how long viewers wait for it.",
      [2, 4.4, 7.1],
      [0.9, 2.1, 3.3],
    ),
    sampleEdit(
      "trim-2",
      { op: "trim", beat: 2, keep: 0.5 },
      20,
      70,
      "Trim the explanation at 0:20 to 25 s",
      "Newcomers leave faster the longer it runs, mostly because of its pace.",
      [-1.2, 2.1, 5],
      [1.1, 3.4, 5.6],
    ),
    sampleEdit(
      "remove-6",
      { op: "remove", beat: 6 },
      200,
      212,
      "Cut the call to action at 3:20 (12 s)",
      "Newcomers are predicted to leave a little faster during it.",
      [-0.8, 0.6, 2.1],
      [0.4, 1.2, 2],
    ),
  ],
  recommendedEffect: null,
  chapters: [
    { firstBeat: 0, title: "Will it play in tune?" },
    { firstBeat: 2, title: "Shaping the neck" },
    { firstBeat: 4, title: "The first chords" },
  ],
  narrative:
    "Subscribers should watch about 53% of this cut (46 to 59%), and newcomers about 35% (29 to 42%). That is better than 67% of your 3 recent videos.",
  extractionVersion: "beats-v3",
  featureVersion: "sample",
  createdAt: "2026-10-13T09:00:00.000Z",
  updatedAt: "2026-10-13T09:04:00.000Z",
};
