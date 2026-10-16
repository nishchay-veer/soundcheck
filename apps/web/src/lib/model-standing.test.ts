import type { AudienceCard, ModelStamp } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { modelStanding, standingOf } from "./model-standing";

const stamp = (usable: boolean, reasons: string[] = []): ModelStamp => ({
  runId: "r",
  usable,
  unusableReasons: usable ? [] : reasons,
  trainedVideos: usable ? 8 : 2,
});
const card = (label: string, model: ModelStamp | null) => ({ label, model }) as AudienceCard;

describe("model standing", () => {
  it("names each audience whose model is not usable, with its reasons, and the usable ones", () => {
    expect(
      modelStanding([
        card("Subscribers", stamp(false, ["trained on 2 videos; at least 20 are needed"])),
        card("Newcomers", stamp(true)),
        card("Newcomers from search", null),
      ]),
    ).toEqual({
      notUsable: [
        { label: "Subscribers", reasons: ["trained on 2 videos; at least 20 are needed"] },
      ],
      usable: ["Newcomers"],
    });
  });

  it("labels a video's or a soundcheck's audiences from their keys", () => {
    expect(
      standingOf({
        subscribed: { model: stamp(false, ["trained on 2 videos; at least 20 are needed"]) },
        unsubscribed: { model: stamp(true) },
      }),
    ).toEqual({
      notUsable: [
        { label: "Subscribers", reasons: ["trained on 2 videos; at least 20 are needed"] },
      ],
      usable: ["Newcomers"],
    });
    expect(standingOf({ unsubscribed: { model: null } })).toEqual({ notUsable: [], usable: [] });
  });
});
