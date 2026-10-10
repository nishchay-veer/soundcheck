import { describe, expect, it } from "vitest";
import { modelRunRowSchema } from "./bigquery";
import { modelArtifactSchema, type ModelArtifact } from "./model-artifact";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";

/** A two-column model: one spline column (unpenalized) and one content column. */
const artifact: ModelArtifact = {
  runId: "run1",
  channelId: CHANNEL,
  audience: "subscribed",
  modelVersion: "hazard-v1",
  featureVersion: "feat-abc",
  extractionVersion: "beats-v5",
  createdAt: "2026-10-10T12:00:00.000Z",
  featureNames: ["pos_b1", "energy"],
  droppedFeatures: ["beat_sponsor"],
  unpenalized: ["pos_b1"],
  mean: [0.2, 3],
  sd: [0.1, 1],
  alpha: -3,
  beta: [0.5, -0.2],
  cov: [
    [0.04, 0, 0],
    [0, 0.01, 0],
    [0, 0, 0.02],
  ],
  lambda: 3,
  priorRef: null,
  trainChannelIds: [CHANNEL],
  trainVideoIds: ["vid1", "vid2"],
  channelContext: { medianTargetLevel: 2, mixMean: { search: 0.2, suggested: 0.3, browse: 0.4 } },
  usable: false,
  unusableReasons: ["trained on 2 videos; at least 30 are needed"],
  metrics: {
    rows: 200,
    videos: 2,
    trainLoss: 0.05,
    cv: [{ lambda: 3, loss: 0.06 }],
    folds: 2,
    iterations: 12,
    converged: true,
    gradientNorm: 1e-7,
    dispersion: 0.002,
    effectiveParameters: 8,
  },
};

const issues = (value: unknown) =>
  modelArtifactSchema.safeParse(value).error?.issues.map((issue) => issue.message) ?? [];

describe("modelArtifactSchema", () => {
  it("accepts a consistent artifact", () => {
    expect(modelArtifactSchema.parse(artifact)).toEqual(artifact);
  });

  it("needs one mean, sd and coefficient per column and a square covariance with the intercept", () => {
    expect(issues({ ...artifact, beta: [0.5] })).toEqual(["beta has 1 values, not 2"]);
    expect(
      issues({
        ...artifact,
        cov: [
          [1, 0],
          [0, 1],
        ],
      }),
    ).toEqual(["cov must be 3 by 3"]);
    expect(issues({ ...artifact, sd: [0.1, 0] })).toHaveLength(1);
  });

  it("ties usable to the reasons and the pooled model to having no channel context", () => {
    expect(issues({ ...artifact, usable: true })).toEqual([
      "a usable model has no unusable reasons, and an unusable one has at least one",
    ]);
    expect(issues({ ...artifact, channelId: null })).toEqual([
      "the pooled model, and only it, has no channel context",
    ]);
    expect(issues({ ...artifact, channelId: null, channelContext: null })).toEqual([]);
    expect(issues({ ...artifact, unpenalized: ["pos_b2"] })).toEqual([
      "unpenalized columns not in the model: pos_b2",
    ]);
  });
});

describe("modelRunRowSchema", () => {
  const row = {
    run_id: "run1",
    channel_id: CHANNEL,
    audience: "all",
    model_version: "hazard-v1",
    feature_version: "feat-abc",
    status: "fitted",
    started_at: "2026-10-10T12:00:00.000Z",
    finished_at: "2026-10-10T12:00:05.000Z",
    artifact_uri: `gs://bucket/${CHANNEL}/models/run1/all.json`,
    details: {},
  };

  it("accepts a channel's run and the pooled model's run", () => {
    expect(modelRunRowSchema.parse(row)).toEqual(row);
    expect(modelRunRowSchema.parse({ ...row, channel_id: "pooled" }).channel_id).toBe("pooled");
    expect(modelRunRowSchema.safeParse({ ...row, channel_id: "someone" }).success).toBe(false);
    expect(modelRunRowSchema.safeParse({ ...row, artifact_uri: "https://x" }).success).toBe(false);
  });
});
