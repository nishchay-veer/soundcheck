import { describe, expect, it } from "vitest";
import { MIN_JUDGED_SHARE, judging } from "./judge";

const weights = { subscribed: 0.2, unsubscribed: 0.8 };

describe("judging", () => {
  it("judges on every audience when every model is usable", () => {
    expect(judging(weights, { subscribed: true, unsubscribed: true })).toEqual({
      audiences: ["subscribed", "unsubscribed"],
      weights,
    });
  });

  it("judges on the usable audiences alone when they bring most of the views", () => {
    expect(judging(weights, { subscribed: false, unsubscribed: true })).toEqual({
      audiences: ["unsubscribed"],
      weights: { subscribed: 0, unsubscribed: 1 },
    });
  });

  it("recommends nothing when the usable audiences bring too few views, or none is usable", () => {
    expect(judging(weights, { subscribed: true, unsubscribed: false })).toBeNull();
    expect(judging(weights, { subscribed: false, unsubscribed: false })).toBeNull();
    expect(judging(weights, {})).toBeNull();
  });

  it("counts half the views as enough", () => {
    expect(MIN_JUDGED_SHARE).toBe(0.5);
    expect(
      judging({ subscribed: 0.5, unsubscribed: 0.5 }, { subscribed: true, unsubscribed: false }),
    ).toEqual({ audiences: ["subscribed"], weights: { subscribed: 1, unsubscribed: 0 } });
  });

  it("leaves out an audience without a model", () => {
    expect(judging(weights, { unsubscribed: true })).toEqual({
      audiences: ["unsubscribed"],
      weights: { subscribed: 0, unsubscribed: 1 },
    });
  });
});
