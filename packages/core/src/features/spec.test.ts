import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FEATURE_VERSION } from "../versions";
import {
  beatTypeSchema,
  featureSpecDocumentSchema,
  videoFormatSchema,
  visualSchema,
} from "../schemas";
import {
  FEATURE_NAMES,
  FEATURE_SPEC,
  FEATURE_SPEC_DOCUMENT,
  INTERACTION_FEATURES,
  LEAKAGE,
  MIX_BUCKETS,
  featureIndex,
  leakedFeatures,
} from "./spec";

describe("FEATURE_SPEC", () => {
  it("is a valid spec document with unique column names", () => {
    expect(featureSpecDocumentSchema.parse(FEATURE_SPEC_DOCUMENT)).toEqual(FEATURE_SPEC_DOCUMENT);
    expect(new Set(FEATURE_NAMES).size).toBe(FEATURE_NAMES.length);
    FEATURE_NAMES.forEach((name, index) => expect(featureIndex(name)).toBe(index));
    expect(() => featureIndex("no_such_feature")).toThrow(RangeError);
  });

  it("matches FEATURE_VERSION: changing the spec without bumping the version fails here", () => {
    const hash = createHash("sha256")
      .update(JSON.stringify(FEATURE_SPEC_DOCUMENT))
      .digest("hex")
      .slice(0, 12);
    expect(
      FEATURE_VERSION,
      `The feature spec changed. Set FEATURE_VERSION in versions.ts to "feat-${hash}".`,
    ).toBe(`feat-${hash}`);
  });

  it("has a share column for every beat type, visual and format", () => {
    for (const type of beatTypeSchema.options) expect(FEATURE_NAMES).toContain(`beat_${type}`);
    for (const visual of visualSchema.options) expect(FEATURE_NAMES).toContain(`visual_${visual}`);
    for (const format of videoFormatSchema.options) {
      expect(FEATURE_NAMES).toContain(`format_${format}`);
    }
  });

  it("drops one of the seven position basis functions for the intercept", () => {
    const spline = FEATURE_SPEC.filter((feature) => feature.kind === "spline");
    expect(spline.map((feature) => feature.name)).toEqual([
      "pos_b1",
      "pos_b2",
      "pos_b3",
      "pos_b4",
      "pos_b5",
      "pos_b6",
    ]);
  });

  it("interacts each of the six content features with each mix share", () => {
    const interactions = FEATURE_SPEC.filter((feature) => feature.kind === "interaction");
    expect(interactions).toHaveLength(INTERACTION_FEATURES.length * MIX_BUCKETS.length);
    expect(INTERACTION_FEATURES).toHaveLength(6);
    for (const feature of INTERACTION_FEATURES) {
      expect(FEATURE_NAMES).toContain(feature);
      for (const bucket of MIX_BUCKETS) expect(FEATURE_NAMES).toContain(`ix_${feature}_${bucket}`);
    }
  });

  it("clips every column to an ordered range, except the interactions", () => {
    for (const feature of FEATURE_SPEC) {
      if (feature.kind === "interaction") {
        expect(feature.clip).toBeNull();
      } else {
        const [low, high] = feature.clip ?? [Number.NaN, Number.NaN];
        expect(low, feature.name).toBeLessThan(high);
      }
    }
  });
});

describe("leakage", () => {
  it("keeps every outcome-derived value out of the spec", () => {
    expect(leakedFeatures(FEATURE_NAMES)).toEqual([]);
  });

  it("catches a leakage value anywhere in a name, but not inside a longer word", () => {
    expect(
      leakedFeatures(["log1p_views", "ix_hazard_search", "s_mono", "format_review", "views_x"]),
    ).toEqual(["log1p_views", "ix_hazard_search", "s_mono", "views_x"]);
    expect(LEAKAGE).toContain("rewatch_mass");
  });
});
