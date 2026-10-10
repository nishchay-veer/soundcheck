import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_NAMES, FEATURE_SPEC } from "../features";
import { MODEL_VERSION } from "../versions";
import {
  CONTENT_FEATURES,
  MODEL_CONFIG,
  NEWCOMER_FEATURES,
  POSITION_FEATURES,
  UNPENALIZED_FEATURES,
  modelColumns,
} from "./config";
import { MODEL_EXPORTS_DIR, modelExports } from "./exports";

describe("model columns", () => {
  it("are columns of the feature spec, each used once", () => {
    for (const audience of ["all", "subscribed", "unsubscribed"] as const) {
      const columns = modelColumns(audience);
      expect(columns.filter((name) => !FEATURE_NAMES.includes(name))).toEqual([]);
      expect(new Set(columns).size).toBe(columns.length);
    }
  });

  it("are position and 20 content features, plus the mix and 18 interactions for newcomers", () => {
    expect(POSITION_FEATURES).toHaveLength(8);
    expect(CONTENT_FEATURES).toHaveLength(20);
    expect(NEWCOMER_FEATURES).toHaveLength(21);
    expect(modelColumns("all")).toEqual(modelColumns("subscribed"));
    expect(modelColumns("all")).toHaveLength(28);
    expect(modelColumns("unsubscribed")).toHaveLength(49);
  });

  it("leave only the spline columns unpenalized", () => {
    const spline = FEATURE_SPEC.filter((feature) => feature.kind === "spline");
    expect(UNPENALIZED_FEATURES).toEqual(spline.map((feature) => feature.name));
    expect(MODEL_CONFIG.modelVersion).toBe(MODEL_VERSION);
  });
});

describe("modelExports", () => {
  it("match the committed files: run `pnpm gen:schemas` after changing a schema or the config", () => {
    for (const [name, value] of Object.entries(modelExports())) {
      const committed: unknown = JSON.parse(
        readFileSync(new URL(`../../../../${MODEL_EXPORTS_DIR}/${name}`, import.meta.url), "utf8"),
      );
      expect(committed, `${MODEL_EXPORTS_DIR}/${name} is stale`).toEqual(
        JSON.parse(JSON.stringify(value)),
      );
    }
  });
});
