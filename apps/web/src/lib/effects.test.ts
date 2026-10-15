import { SCENARIOS } from "@soundcheck/core/model";
import { describe, expect, it } from "vitest";
import {
  EFFECT_TEXT,
  effectSentence,
  effectText,
  groupEffects,
  traitLine,
  verdictOf,
} from "./effects";

describe("effects in plain words", () => {
  it("name every effect the publish job simulates, with the same numbers as its scenario", () => {
    for (const scenario of SCENARIOS) {
      const feature = scenario.features[0] as string;
      const text = EFFECT_TEXT[feature];
      expect(text, feature).toBeDefined();
      // "30 s at 30%" must stay "30-second … 30% of the way in"; "halfway" is 50%.
      const tried = (text?.tried ?? "").replace(/halfway/g, "50%");
      for (const number of scenario.condition.match(/\d+/g) ?? []) {
        expect(tried, `${feature}: ${scenario.condition}`).toContain(number);
      }
    }
    expect(Object.keys(EFFECT_TEXT).sort()).toEqual(
      SCENARIOS.map((scenario) => scenario.features[0]).sort(),
    );
  });

  it("fall back to the job's own label for an effect they don't know", () => {
    expect(effectText({ feature: "beat_sponsor", label: "A 30 s sponsor read at 30%" })).toEqual({
      name: "Sponsor reads",
      tried: "Adding a 30-second sponsor read 30% of the way in",
    });
    expect(effectText({ feature: "new_thing", label: "a new thing at 10%" })).toEqual({
      name: "A new thing at 10%",
      tried: null,
    });
  });

  it("say whether an effect keeps viewers, loses them, can't tell, or was never in the videos", () => {
    expect(verdictOf({ deltaPp: 3.4, ci: [1.2, 5.6] })).toBe("keeps");
    expect(verdictOf({ deltaPp: -1.8, ci: [-3.1, -0.4] })).toBe("loses");
    expect(verdictOf({ deltaPp: -0.6, ci: [-2.4, 1.1] })).toBe("unclear");
    expect(verdictOf({ deltaPp: null, ci: null })).toBe("absent");
  });

  it("count viewers out of 100 instead of points and intervals", () => {
    expect(effectSentence({ deltaPp: 3.4, ci: [1.2, 5.6] })).toBe(
      "About 3 more of every 100 viewers stay to the end (between 1 and 6).",
    );
    expect(effectSentence({ deltaPp: -1.8, ci: [-3.1, -0.4] })).toBe(
      "About 2 fewer of every 100 viewers stay to the end (between 0.4 and 3).",
    );
    expect(effectSentence({ deltaPp: 0.6, ci: [0.2, 1.1] })).toBe(
      "Under 1 more of every 100 viewers stays to the end (between 0.2 and 1).",
    );
    expect(effectSentence({ deltaPp: -0.6, ci: [-2.4, 1.1] })).toBeNull();
    expect(effectSentence({ deltaPp: null, ci: null })).toBeNull();
    expect(traitLine({ deltaPp: 3.4 })).toBe("about 3 more in 100 stay");
    expect(traitLine({ deltaPp: -0.4 })).toBe("under 1 fewer in 100 stays");
  });

  it("group effects by what they say, keeping their order", () => {
    const groups = groupEffects([
      { feature: "a", deltaPp: 3.4, ci: [1.2, 5.6] as [number, number] },
      { feature: "b", deltaPp: -0.6, ci: [-2.4, 1.1] as [number, number] },
      { feature: "c", deltaPp: null, ci: null },
      { feature: "d", deltaPp: 0.2, ci: [-0.1, 0.5] as [number, number] },
    ]);
    expect(
      Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, v.map((e) => e.feature)])),
    ).toEqual({
      keeps: ["a"],
      loses: [],
      unclear: ["b", "d"],
      absent: ["c"],
    });
  });
});
