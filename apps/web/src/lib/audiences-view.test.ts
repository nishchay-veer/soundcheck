import type { AudienceCard } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { effectDomain, notUsableReasons } from "./audiences-view";

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

  it("scales a sheet to its widest interval, never below 1 point", () => {
    expect(
      effectDomain([
        { feature: "a", label: "A", deltaPp: -1.2, ci: [-4.6, 0.3] },
        { feature: "b", label: "B", deltaPp: null, ci: null },
      ]),
    ).toBe(4.6);
    expect(effectDomain([{ feature: "c", label: "C", deltaPp: 0.01, ci: [-0.02, 0.05] }])).toBe(1);
  });
});
