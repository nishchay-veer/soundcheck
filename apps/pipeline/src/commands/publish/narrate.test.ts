import { checkCaption } from "@soundcheck/core/gemini";
import type { AudienceCard, ModelStamp } from "@soundcheck/core/schemas";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DropAttribution } from "./attribution";
import { audienceNarration, dropNarration, headlineNarration } from "./narrate";

const usable: ModelStamp = { runId: "run1", usable: true, unusableReasons: [], trainedVideos: 40 };
const notUsable: ModelStamp = {
  runId: "run1",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 30 are needed"],
  trainedVideos: 3,
};
const span = { binStart: 28, binEnd: 30, startS: 71.6, endS: 79.6, actualLossPp: 6.43 };
const attribution: DropAttribution = {
  attributions: [
    { group: "sponsor", label: "Sponsor segment", share: 0.552 },
    { group: "position", label: "Position in video", share: 0.15 },
    { group: "energy", label: "Delivery energy", share: 0.006 },
  ],
  residualShare: 0.292,
};
const card: Omit<AudienceCard, "description"> = {
  effects: [],
  key: "unsubscribed",
  label: "Newcomers",
  kind: "measured",
  viewShare: 0.617,
  watchTimeShare: 0.549,
  avgViewPct: 41.27,
  traits: [
    {
      feature: "beat_sponsor",
      statement: "a 30 s sponsor read at 30%",
      deltaPp: -2.13,
      ci: [-3.4, -0.6],
    },
  ],
  model: usable,
};

describe("dropNarration", () => {
  it("gives the measured loss, and the model's causes when it is usable", () => {
    const item = dropNarration("v:unsubscribed:28", {
      audience: "unsubscribed",
      span,
      attribution,
      model: usable,
    });
    expect(item.facts).toEqual({
      audience: "Newcomers",
      start: "1:12",
      end: "1:20",
      startersLostPercent: "6.4",
      causes: [
        { cause: "sponsor segment", percent: "55" },
        { cause: "position in video", percent: "15" },
        { cause: "delivery energy", percent: "1" },
      ],
      unexplainedPercent: "29",
    });
    expect(item.fallback).toBe(
      "6.4% of newcomers who started the video left between 1:12 and 1:20. The model's top cause: sponsor segment (55%).",
    );
    expect(checkCaption(item.fallback, item)).toEqual([]);
  });

  it("names no cause when the model is not usable, or there is none", () => {
    for (const model of [notUsable, null]) {
      const item = dropNarration("d", { audience: "subscribed", span, attribution, model });
      expect(item.facts).not.toHaveProperty("causes");
      expect(item.fallback).toBe(
        "6.4% of subscribers who started the video left between 1:12 and 1:20.",
      );
    }
  });
});

describe("audienceNarration", () => {
  it("describes a card from its numbers, with traits only from a usable model", () => {
    const item = audienceNarration(card);
    expect(item.id).toBe("audience:unsubscribed");
    expect(item.facts).toMatchObject({
      viewSharePercent: "62",
      watchTimeSharePercent: "55",
      averageViewPercent: "41.3",
      traits: [{ trait: "a 30 s sponsor read at 30%", points: "-2.1" }],
    });
    expect(item.fallback).toBe(
      "Newcomers bring 62% of your views and watch 41.3% of a video on average.",
    );
    expect(audienceNarration({ ...card, model: notUsable }).facts).not.toHaveProperty("traits");
    const search = audienceNarration({
      ...card,
      key: "search",
      label: "Newcomers from search",
      kind: "estimated",
      watchTimeShare: null,
      avgViewPct: null,
    });
    expect(search.fallback).toBe("Newcomers from search bring 62% of your views.");
  });
});

describe("headlineNarration", () => {
  it("sums up the measured audiences, and the evaluation when there is one", () => {
    const item = headlineNarration({
      videosAnalysed: 3,
      cards: [card, { ...card, label: "Subscribers", avgViewPct: 52.06 }],
      evaluation: null,
    });
    expect(item.fallback).toBe(
      "Across 3 videos, newcomers watch 41.3% and subscribers watch 52.1% of a video on average.",
    );
    expect(item.facts).not.toHaveProperty("evaluation");
    const evaluated = headlineNarration({
      videosAnalysed: 1,
      cards: [],
      evaluation: {
        runId: "e",
        testVideos: 8,
        modelErrorPp: 6.21,
        baselineErrorPp: 7.9,
        beatsBaseline: true,
      },
    });
    expect(evaluated.fallback).toBe("1 video analysed.");
    expect(evaluated.facts.evaluation).toEqual({
      modelErrorPoints: "6.2",
      baselineErrorPoints: "7.9",
      beatsChannelAverage: true,
    });
  });
});

describe("templates", () => {
  it("always pass the checks Gemini's captions must pass", () => {
    const share = fc.double({ min: 0, max: 1, noNaN: true });
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 7200, noNaN: true }),
        fc.double({ min: 0.01, max: 100, noNaN: true }),
        share,
        share,
        fc.option(fc.double({ min: 0, max: 400, noNaN: true }), { nil: null }),
        fc.integer({ min: 1, max: 5000 }),
        (startS, lossPp, first, viewShare, avgViewPct, videos) => {
          const drop = dropNarration("d", {
            audience: "unsubscribed",
            span: { binStart: 2, binEnd: 3, startS, endS: startS + 9, actualLossPp: lossPp },
            attribution: {
              attributions: first > 0 ? [{ group: "tangent", label: "Tangent", share: first }] : [],
              residualShare: 1 - first,
            },
            model: usable,
          });
          const audience = audienceNarration({ ...card, viewShare, avgViewPct });
          const headline = headlineNarration({
            videosAnalysed: videos,
            cards: [{ ...card, viewShare, avgViewPct }],
            evaluation: null,
          });
          for (const item of [drop, audience, headline]) {
            expect(checkCaption(item.fallback, item)).toEqual([]);
          }
        },
      ),
    );
  });
});
