import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeatureBeat, FeatureVideo } from "../features";
import type { BeatType, ModelArtifact } from "../schemas";
import { cutSampler } from "./counterfactual";
import type { AudienceMix } from "./cut";
import { judging } from "./judge";
import { loadArtifact } from "./runtime";
import { SEARCH, candidateEdits, editId, searchEdits } from "./search";

const base = loadArtifact(
  JSON.parse(
    readFileSync(
      new URL("../../../../tests/fixtures/parity/artifact.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** A made-up model: tangents make viewers leave much faster, energy keeps them. */
function model(audience: "subscribed" | "unsubscribed", tangent: number): ModelArtifact {
  const names = ["pos_b1", "beat_tangent", "energy"];
  return {
    ...base,
    audience,
    featureNames: names,
    droppedFeatures: [],
    unpenalized: ["pos_b1"],
    mean: [0, 0, 3],
    sd: [1, 1, 1],
    alpha: -4,
    beta: [0.2, tangent, -0.3],
    cov: [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 0.002 : 0))),
  };
}
const artifacts = { subscribed: model("subscribed", 1), unsubscribed: model("unsubscribed", 2) };
const sampler = cutSampler(
  {
    subscribed: { artifact: artifacts.subscribed, inflation: 1 },
    unsubscribed: { artifact: artifacts.unsubscribed, inflation: 1 },
  },
  { seed: 1, draws: 100 },
);
const mix: AudienceMix = {
  mix: { search: 0.3, suggested: 0.5, browse: 0.1 },
  weights: { subscribed: 0.25, unsubscribed: 0.75 },
};

const beat = (
  start: number,
  end: number,
  beat_type: BeatType = "explanation",
  extra: Partial<FeatureBeat> = {},
): FeatureBeat => ({
  start_s: start,
  end_s: end,
  beat_type,
  talking_head_share: 3,
  visual: "b_roll",
  cuts_per_min: 10,
  on_screen_text: false,
  music: "none",
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  transcript: "words",
  words_per_minute: 150,
  ...extra,
});

/** 4 minutes: hook, explanation, a 50 s tangent, a sponsor read, the payoff at 2:40, an outro. */
const cut: FeatureVideo = {
  format: "tutorial",
  target_level: 2,
  payoff_time_s: 160,
  beats: [
    beat(0, 20, "hook", { opens_loop: "Will it work?" }),
    beat(20, 80),
    beat(80, 130, "tangent"),
    beat(130, 160, "sponsor"),
    beat(160, 200, "payoff", { closes_loop: true }),
    beat(200, 240, "outro"),
  ],
};

describe("candidateEdits", () => {
  it("cuts and trims what may go, and moves the payoff earlier", () => {
    expect(candidateEdits(cut, 240).map(editId)).toEqual([
      "trim-0",
      "remove-1",
      "trim-1",
      "remove-2",
      "trim-2",
      "remove-3",
      "trim-3",
      // Before 25% and before 40% of the cut, both after the hook.
      "move-4-to-1",
      "move-4-to-2",
      "remove-5",
      "trim-5",
    ]);
  });

  it("moves sponsors later, the branded intro after the hook, and calls to action to the outro", () => {
    const early: FeatureVideo = {
      ...cut,
      payoff_time_s: null,
      beats: [
        beat(0, 10, "intro_branding"),
        beat(10, 30, "hook"),
        beat(30, 60, "sponsor"),
        beat(60, 100, "cta"),
        beat(100, 150),
        beat(150, 200),
        beat(200, 240, "end_screen"),
      ],
    };
    const moves = candidateEdits(early, 240)
      .filter((edit) => edit.op === "move")
      .map(editId);
    expect(moves).toEqual([
      "move-0-to-2",
      // The first boundaries after 40% (1:36) and 60% (2:24) of the cut.
      "move-2-to-4",
      "move-2-to-5",
      // Just before the end screen.
      "move-3-to-6",
    ]);
  });

  it("offers nothing for a cut of one beat", () => {
    expect(candidateEdits({ ...cut, beats: [beat(0, 240)] }, 240)).toEqual([]);
  });
});

describe("searchEdits", () => {
  const search = (usable = true, objective: "avd" | "avp" = "avd") =>
    searchEdits(sampler, artifacts, { video: cut, durationS: 240 }, mix, { objective, usable });

  it("finds the edits that keep viewers longest, with labels and reasons from the model's numbers", () => {
    const { edits, together } = search();
    // Moving the payoff ahead of the tangent keeps more viewers for longer, and loses no time...
    expect(edits[0]).toMatchObject({
      id: "move-4-to-1",
      label: "Move the payoff at 2:40 to 0:20",
      rationale: "Delivering the payoff sooner cuts how long viewers wait for it.",
      sure: true,
      recommended: true,
    });
    // ...while cutting the tangent helps too, but takes its 50 s with it.
    expect(edits.find((edit) => edit.id === "remove-2")).toMatchObject({
      label: "Cut the tangent at 1:20 (50 s)",
      rationale:
        "Newcomers are predicted to leave faster during it, mostly because of the tangent.",
      sure: true,
      startS: 80,
      endS: 130,
    });
    expect(together?.avdS.delta.p50).toBeGreaterThan(0);
  });

  it("recommends at most five edits, each sure on its own and on different beats, whose sum gains for sure", () => {
    const { edits, together } = search();
    const recommended = edits.filter((edit) => edit.recommended);
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended.length).toBeLessThanOrEqual(SEARCH.maxEdits);
    // Recommended first, then the others.
    expect(edits.slice(0, recommended.length).every((edit) => edit.recommended)).toBe(true);
    expect(new Set(recommended.map((edit) => edit.edit.beat)).size).toBe(recommended.length);
    // Each is sure on its own, so a recommended edit never reads as uncertain.
    expect(recommended.every((edit) => edit.sure)).toBe(true);
    expect(together?.avdS.delta.p10).toBeGreaterThan(0);
    expect(edits.filter((edit) => !edit.recommended).length).toBeLessThanOrEqual(SEARCH.topSingles);
  });

  it("judges edits on newcomers alone when only their model is usable", () => {
    const judged = judging(mix.weights, { subscribed: false, unsubscribed: true });
    const { edits, together } = searchEdits(
      sampler,
      artifacts,
      { video: cut, durationS: 240 },
      { ...mix, weights: judged?.weights ?? mix.weights },
      { usable: judged !== null },
    );
    expect(edits.some((edit) => edit.recommended)).toBe(true);
    for (const edit of edits) {
      // The number shown is the newcomers' own, and they are the ones named in the reason.
      expect(edit.avdS.delta).toEqual(edit.avdS.byAudience.unsubscribed);
      expect(edit.avdS.driver).toBe("unsubscribed");
      expect(edit.rationale).not.toMatch(/^Subscribers/);
    }
    expect(together?.avdS.delta).toEqual(together?.avdS.byAudience.unsubscribed);
  });

  it("judges by seconds watched by default, which merely shortening the cut does not raise", () => {
    const seconds = search();
    const share = search(true, "avp");
    // By share of the cut, cutting the tangent wins, and cutting the outro "helps"...
    expect(share.edits[0]?.id).toBe("remove-2");
    expect(share.edits.some((edit) => edit.id === "remove-5")).toBe(true);
    // ...but cutting the outro loses seconds watched, so it is not listed by default.
    expect(seconds.edits.some((edit) => edit.id === "remove-5")).toBe(false);
  });

  it("lists edits but recommends none while the model is not usable", () => {
    const { edits, together } = search(false);
    expect(edits.length).toBeGreaterThan(0);
    expect(edits.some((edit) => edit.recommended)).toBe(false);
    expect(together).toBeNull();
  });

  it("gives the same answer every time", () => {
    expect(search()).toEqual(search());
  });

  it("ranks by the objective it is asked for", () => {
    const { edits } = search(false, "avp");
    for (let i = 1; i < edits.length; i += 1) {
      expect(edits[i - 1]?.avp.delta.p50).toBeGreaterThanOrEqual(
        edits[i]?.avp.delta.p50 ?? -Infinity,
      );
    }
  });
});
