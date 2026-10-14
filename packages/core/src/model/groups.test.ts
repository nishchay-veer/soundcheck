import { describe, expect, it } from "vitest";
import { CONTENT_FEATURES, POSITION_FEATURES, modelColumns } from "./config";
import { groupOf } from "./groups";

describe("groupOf", () => {
  it("groups every column of every audience's model, and the mix is never a cause", () => {
    for (const audience of ["all", "subscribed", "unsubscribed"] as const) {
      for (const column of modelColumns(audience)) expect(() => groupOf(column)).not.toThrow();
    }
    for (const feature of CONTENT_FEATURES) expect(groupOf(feature)).not.toBe("position");
    for (const feature of POSITION_FEATURES) expect(groupOf(feature)).toBe("position");
    expect(groupOf("ix_beat_sponsor_search")).toBe("sponsor");
    expect(groupOf("mix_browse")).toBeNull();
    expect(() => groupOf("new_feature")).toThrow(/No attribution group/);
  });
});
