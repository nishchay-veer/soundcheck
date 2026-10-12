import { describe, expect, it } from "vitest";
import {
  ATTRIBUTION_GROUPS,
  attributionGroupSchema,
  audienceCardSchema,
  bandSchema,
  curveSchema,
  dropSchema,
  modelStampSchema,
  servingPaths,
  soundcheckDocSchema,
  summaryDocSchema,
  videoAudienceSchema,
  videoDocSchema,
  videoIdSchema,
  videoIndexDocSchema,
  type AudienceCard,
  type Drop,
  type VideoDoc,
} from "./index";

const CHANNEL = "UC-BHlgFbFh3V76yth-XCmlw";
const RUN = "d81fba4cba194878a25705b6d33d9e5f";
const AT = "2026-10-11T09:00:00.000Z";

const curve = (start = 0.9, step = 0.006) =>
  Array.from({ length: 100 }, (_, i) => start - step * i);
const band = () => ({
  p10: curve(0.85),
  p50: curve(0.9),
  p90: curve(0.95),
});
const notUsable = {
  runId: "0c1f3fcc1600421db60ca923584a659b",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 30 are needed"],
  trainedVideos: 3,
};

const card = (overrides: Partial<AudienceCard> = {}): AudienceCard => ({
  key: "unsubscribed",
  label: "Newcomers",
  kind: "measured",
  viewShare: 0.62,
  watchTimeShare: 0.55,
  avgViewPct: 41.3,
  traits: [
    {
      feature: "beat_sponsor",
      statement: "Sponsor segments cost newcomers",
      deltaPp: -2.1,
      ci: [-3.4, -0.6],
    },
  ],
  effects: [
    {
      feature: "beat_sponsor",
      label: "A 30 s sponsor read at 30%",
      deltaPp: -2.1,
      ci: [-3.4, -0.6],
    },
    { feature: "energy", label: "Energy one point higher", deltaPp: 0.4, ci: [-0.2, 1.1] },
    { feature: "beat_cta", label: "A 15 s call to action at 50%", deltaPp: null, ci: null },
  ],
  description: "Newcomers arrive from search and leave early when the intro runs long.",
  model: notUsable,
  ...overrides,
});

const drop = (overrides: Partial<Drop> = {}): Drop => ({
  audience: "unsubscribed",
  startS: 70.2,
  endS: 79.9,
  binStart: 31,
  binEnd: 34,
  actualLossPp: 6.4,
  attributions: [
    { group: "sponsor", label: "Sponsor segment", share: 0.55 },
    { group: "position", label: "Position in video", share: 0.15 },
  ],
  residualShare: 0.3,
  narrative: "Newcomers drop 6.4 points during the sponsor read.",
  ...overrides,
});

const video = (overrides: Partial<VideoDoc> = {}): VideoDoc => ({
  channelId: CHANNEL,
  videoId: "lgxOjPdCGkw",
  runId: RUN,
  generatedAt: AT,
  title: "A cover",
  publishedAt: "2026-08-01T12:00:00.000Z",
  durationS: 262,
  thumbnailUrl: "https://i.ytimg.com/vi/lgxOjPdCGkw/hqdefault.jpg",
  stats: { views: 812, avdS: 104.2, avp: 39.8 },
  audiences: {
    subscribed: { actual: curve(0.95), predicted: band(), model: notUsable },
    unsubscribed: { actual: curve(), predicted: band(), model: notUsable },
  },
  beats: [
    {
      startS: 0,
      endS: 12,
      beatType: "hook",
      visual: "none",
      talkingHeadShare: 5,
      summary: "Opens on the chorus.",
    },
  ],
  drops: [drop()],
  inSample: true,
  ...overrides,
});

describe("serving documents", () => {
  it("accepts a full set of documents for a channel", () => {
    expect(
      summaryDocSchema.safeParse({
        channelId: CHANNEL,
        runId: RUN,
        generatedAt: AT,
        videosAnalysed: 3,
        beatsExtracted: 23,
        evaluation: null,
        headline: "Newcomers leave early; subscribers stay for the chorus.",
        audiences: [card({ key: "subscribed", label: "Subscribers" }), card()],
      }).success,
    ).toBe(true);
    expect(videoDocSchema.safeParse(video()).success).toBe(true);
    expect(
      videoIndexDocSchema.safeParse({
        channelId: CHANNEL,
        runId: RUN,
        generatedAt: AT,
        videos: [
          {
            videoId: "lgxOjPdCGkw",
            title: "A cover",
            publishedAt: "2026-08-01T12:00:00.000Z",
            durationS: 262,
            thumbnailUrl: null,
            avgViewPct: 39.8,
            biggestDrop: { audience: "unsubscribed", atS: 70.2, lossPp: 6.4 },
            inSample: true,
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      soundcheckDocSchema.safeParse({
        channelId: CHANNEL,
        status: "ready",
        input: { kind: "video", uri: "gs://uploads/UC/cut.mp4", title: "New cut", scenario: null },
        durationS: 240,
        beats: [],
        prediction: {
          audiences: { unsubscribed: band() },
          avdS: { p10: 80, p50: 96, p90: 110 },
          avp: { p10: 33, p50: 40, p90: 46 },
        },
        percentileVsChannel: 62,
        edits: [
          {
            editId: "e1",
            op: "trim",
            beatIndex: 2,
            params: { startS: 30, endS: 41 },
            label: "Trim the intro",
            rationale: "Newcomers leave during long intros.",
            deltaAvpPp: { p10: 0.4, p50: 1.6, p90: 2.9 },
            deltaAvdS: { p10: 1, p50: 4, p90: 7 },
            audienceDriver: "unsubscribed",
          },
        ],
        narrative: null,
        visualAssumed: false,
        createdAt: AT,
        updatedAt: AT,
      }).success,
    ).toBe(true);
  });

  it("needs 100 shares per curve and ordered percentiles", () => {
    expect(curveSchema.safeParse(curve().slice(1)).success).toBe(false);
    expect(curveSchema.safeParse([1.2, ...curve().slice(1)]).success).toBe(false);
    const crossed = band();
    crossed.p50[40] = (crossed.p90[40] as number) + 0.01;
    expect(bandSchema.safeParse(crossed).success).toBe(false);
  });

  it("stamps every prediction with its model, usable exactly when nothing is against it", () => {
    expect(modelStampSchema.safeParse(notUsable).success).toBe(true);
    expect(modelStampSchema.safeParse({ ...notUsable, usable: true }).success).toBe(false);
    expect(modelStampSchema.safeParse({ ...notUsable, unusableReasons: [] }).success).toBe(false);
    expect(
      videoAudienceSchema.safeParse({ actual: curve(), predicted: band(), model: null }).success,
    ).toBe(false);
    expect(
      videoAudienceSchema.safeParse({ actual: curve(), predicted: null, model: null }).success,
    ).toBe(true);
  });

  it("keeps audience cards honest", () => {
    expect(audienceCardSchema.safeParse(card()).success).toBe(true);
    // Search newcomers are estimated, never measured.
    expect(audienceCardSchema.safeParse(card({ key: "search" })).success).toBe(false);
    expect(
      audienceCardSchema.safeParse(
        card({ key: "search", kind: "estimated", watchTimeShare: null, avgViewPct: null }),
      ).success,
    ).toBe(true);
    // A shown trait's interval excludes zero.
    const unsure = { feature: "energy", statement: "Energy", deltaPp: 0.4, ci: [-0.2, 1.1] };
    expect(audienceCardSchema.safeParse(card({ traits: [unsure] as never })).success).toBe(false);
    const sure = card().traits[0];
    expect(
      audienceCardSchema.safeParse(card({ traits: [sure, sure, sure, sure] as never })).success,
    ).toBe(false);
    expect(audienceCardSchema.safeParse(card({ description: "word ".repeat(31) })).success).toBe(
      false,
    );
    // Without a model, the measured numbers still show, but no traits or effects.
    expect(audienceCardSchema.safeParse(card({ model: null, traits: [] })).success).toBe(false);
    expect(
      audienceCardSchema.safeParse(card({ model: null, traits: [], effects: [] })).success,
    ).toBe(true);
    // Every effect, clear or not; one never learned has neither a value nor an interval.
    const [first] = card().effects;
    for (const broken of [
      { ...first, ci: null },
      { ...first, deltaPp: null },
      { ...first, ci: [1, -1] },
    ]) {
      expect(audienceCardSchema.safeParse(card({ effects: [broken] as never })).success).toBe(
        false,
      );
    }
  });

  it("allows one card per audience in a summary", () => {
    const summary = {
      channelId: CHANNEL,
      runId: RUN,
      generatedAt: AT,
      videosAnalysed: 3,
      beatsExtracted: 23,
      evaluation: null,
      headline: "A headline.",
      audiences: [card(), card()],
    };
    expect(summaryDocSchema.safeParse(summary).success).toBe(false);
  });

  it("makes attribution shares and the residual account for the whole drop-off", () => {
    expect(dropSchema.safeParse(drop()).success).toBe(true);
    // Float rounding is fine; a missing tenth is not.
    const rounded = drop({ residualShare: 0.3 + 1e-9 });
    expect(dropSchema.safeParse(rounded).success).toBe(true);
    expect(dropSchema.safeParse(drop({ residualShare: 0.2 })).success).toBe(false);
    // With no model, the residual is everything.
    expect(dropSchema.safeParse(drop({ attributions: [], residualShare: 1 })).success).toBe(true);
    const twice = drop({
      attributions: [
        { group: "sponsor", label: "Sponsor segment", share: 0.35 },
        { group: "sponsor", label: "Sponsor segment", share: 0.35 },
      ],
    });
    expect(dropSchema.safeParse(twice).success).toBe(false);
    expect(dropSchema.safeParse(drop({ endS: 70.2 })).success).toBe(false);
  });

  it("keeps at most four drop-offs per audience on a video", () => {
    const four = Array.from({ length: 4 }, () => drop());
    expect(videoDocSchema.safeParse(video({ drops: four })).success).toBe(true);
    expect(videoDocSchema.safeParse(video({ drops: [...four, drop()] })).success).toBe(false);
    const other = drop({ audience: "subscribed" });
    expect(videoDocSchema.safeParse(video({ drops: [...four, other] })).success).toBe(true);
  });

  it("labels every attribution group", () => {
    for (const group of attributionGroupSchema.options) {
      expect(ATTRIBUTION_GROUPS[group].length).toBeGreaterThan(0);
    }
  });

  it("accepts YouTube video IDs only, so a route parameter cannot become a path", () => {
    expect(videoIdSchema.safeParse("lgxOjPdCGkw").success).toBe(true);
    for (const id of ["lgxOjPdCGk", "../summary", "lgxOjPdCGkw/x", ""]) {
      expect(videoIdSchema.safeParse(id).success).toBe(false);
    }
  });

  it("knows where each document lives", () => {
    const paths = servingPaths(CHANNEL);
    expect(paths.summary).toBe(`channels/${CHANNEL}/summary/current`);
    expect(paths.videoIndex).toBe(`channels/${CHANNEL}/index/videos`);
    expect(paths.video("lgxOjPdCGkw")).toBe(`channels/${CHANNEL}/videos/lgxOjPdCGkw`);
  });
});
