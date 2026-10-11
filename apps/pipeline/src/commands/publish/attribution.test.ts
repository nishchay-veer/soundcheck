import { readFileSync } from "node:fs";
import type { FeatureFrame } from "@soundcheck/core/features";
import {
  CONTENT_FEATURES,
  loadArtifact,
  logitTerms,
  modelColumns,
  POSITION_FEATURES,
  predictHazard,
} from "@soundcheck/core/model";
import { describe, expect, it } from "vitest";
import { attributeDrop, groupOf, referenceBin } from "./attribution";

const BINS = 100;
const DROP = { binStart: 40, binEnd: 42 };
const inDrop = (bin: number) => bin >= DROP.binStart - 1 && bin <= DROP.binEnd - 1;

/** A frame from one function per column, of the bin index (from 0). */
function frameOf(columns: Record<string, (bin: number) => number>): FeatureFrame {
  const names = Object.keys(columns);
  const values = new Float64Array(names.length * BINS);
  names.forEach((name, j) => {
    for (let bin = 0; bin < BINS; bin += 1) values[j * BINS + bin] = columns[name]?.(bin) ?? 0;
  });
  return { rows: BINS, columns: names, values };
}

// A sponsor read in bins 40 to 42, delivered with less energy; the traffic
// mix is the same in every bin.
const frame = frameOf({
  log_bin_seconds: () => 0,
  beat_sponsor: (bin) => (inDrop(bin) ? 1 : 0),
  energy: (bin) => (inDrop(bin) ? 2 : 3),
  mix_search: () => 0.2,
});
const model = {
  featureNames: [...frame.columns],
  mean: [0, 0, 0, 0],
  sd: [1, 1, 1, 1],
  beta: [0.4, 1.2, -0.5, 0.3],
};
const ALPHA = -3;

/** Measured hazards: the model's, plus `extra` on the logit scale in the drop-off. */
function measured(extra = 0, columns = frame): number[] {
  return logitTerms(model, columns).map((terms, bin) => {
    const eta = terms.reduce((sum, term) => sum + term, ALPHA) + (inDrop(bin) ? extra : 0);
    return 1 / (1 + Math.exp(-eta));
  });
}

const sum = (result: ReturnType<typeof attributeDrop>) =>
  result.attributions.reduce((total, a) => total + a.share, result.residualShare);

describe("attributeDrop", () => {
  it("splits a drop-off the model fully explains among the groups that push it up", () => {
    // The sponsor read adds 1.2 to the logit and the lower energy 0.5: 1.7 in all.
    const result = attributeDrop(model, frame, measured(), DROP);
    expect(result.attributions.map((a) => [a.group, a.label])).toEqual([
      ["sponsor", "Sponsor segment"],
      ["energy", "Delivery energy"],
    ]);
    expect(result.attributions[0]?.share).toBeCloseTo(1.2 / 1.7, 3);
    expect(result.attributions[1]?.share).toBeCloseTo(0.5 / 1.7, 3);
    expect(result.residualShare).toBeLessThan(0.001);
    expect(sum(result)).toBeCloseTo(1, 12);
  });

  it("leaves what the model does not explain in the residual", () => {
    // The measured drop-off is twice what the model predicts.
    const result = attributeDrop(model, frame, measured(1.7), DROP);
    expect(result.attributions[0]?.share).toBeCloseTo(1.2 / 3.4, 2);
    expect(result.residualShare).toBeCloseTo(0.5, 2);
    expect(sum(result)).toBeCloseTo(1, 12);
  });

  it("never credits a group that pushes the other way", () => {
    // More energy in the drop-off lowers the hazard there.
    const livelier = frameOf({
      log_bin_seconds: () => 0,
      beat_sponsor: (bin) => (inDrop(bin) ? 1 : 0),
      energy: (bin) => (inDrop(bin) ? 4 : 3),
      mix_search: () => 0.2,
    });
    const result = attributeDrop(model, livelier, measured(1, livelier), DROP);
    expect(result.attributions.map((a) => a.group)).toEqual(["sponsor"]);
    expect(sum(result)).toBeCloseTo(1, 12);
  });

  it("names position in the video, and leaves groups under 1% in the residual", () => {
    // Time into the video rises in the drop-off a lot; energy barely changes.
    const late = frameOf({
      log_bin_seconds: (bin) => (inDrop(bin) ? 2 : 0),
      beat_sponsor: (bin) => (inDrop(bin) ? 1 : 0),
      energy: (bin) => (inDrop(bin) ? 2.98 : 3),
      mix_search: () => 0.2,
    });
    const result = attributeDrop(model, late, measured(0, late), DROP);
    expect(result.attributions.map((a) => a.group)).toEqual(["sponsor", "position"]);
    expect(result.attributions[1]?.label).toBe("Position in video");
    expect(result.residualShare).toBeGreaterThan(0);
    expect(result.residualShare).toBeLessThan(0.01);
    expect(sum(result)).toBeCloseTo(1, 12);
  });

  it("explains nothing when the stretch is no worse than the video's typical moment", () => {
    const flat = Array.from({ length: BINS }, () => 0.01);
    expect(attributeDrop(model, frame, flat, DROP)).toEqual({ attributions: [], residualShare: 1 });
  });

  it("works on a real newcomer model with all 49 columns", () => {
    const parity = (name: string): unknown =>
      JSON.parse(
        readFileSync(
          new URL(`../../../../../tests/fixtures/parity/${name}`, import.meta.url),
          "utf8",
        ),
      );
    const artifact = loadArtifact(parity("artifact.json"));
    const raw = parity("frame.json") as { rows: number; columns: string[]; values: number[] };
    const real: FeatureFrame = { ...raw, values: Float64Array.from(raw.values) };
    const hazard = Array.from(predictHazard(artifact, real), (h, bin) =>
      bin >= 59 && bin <= 61 ? Math.min(0.9, h * 4) : h,
    );
    const result = attributeDrop(artifact, real, hazard, { binStart: 60, binEnd: 62 });
    expect(sum(result)).toBeCloseTo(1, 12);
    for (const attribution of result.attributions) expect(attribution.share).toBeGreaterThan(0);
  });
});

describe("referenceBin", () => {
  it("is the median hazard among bins 2 to 100, ignoring the first bin", () => {
    const hazard = Array.from({ length: BINS }, (_, bin) => (bin === 0 ? 0.9 : bin / 1000));
    expect(referenceBin(hazard)).toBe(50);
  });
});

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
