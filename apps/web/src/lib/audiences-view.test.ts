import type { AudienceCard } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { notUsableReasons } from "./audiences-view";

const card = (model: AudienceCard["model"]) => ({ model }) as AudienceCard;
const notUsable = {
  runId: "r",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 30 are needed"],
  trainedVideos: 3,
};

describe("audiences view", () => {
  it("collects each reason against the models once", () => {
    expect(notUsableReasons([card(notUsable), card(notUsable), card(null)])).toEqual([
      "trained on 3 videos; at least 30 are needed",
    ]);
    expect(notUsableReasons([card({ ...notUsable, usable: true, unusableReasons: [] })])).toEqual(
      [],
    );
  });
});
