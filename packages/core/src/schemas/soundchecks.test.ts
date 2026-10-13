import { describe, expect, it } from "vitest";
import {
  SCENARIO_LABELS,
  SOUNDCHECK_LIMITS,
  parseUploadObjectName,
  parseYouTubeLink,
  scenarioSchema,
  soundcheckDocSchema,
  soundcheckInputsSchema,
  soundcheckPaths,
  soundcheckPredictionSchema,
  uploadObjectName,
  type SoundcheckDoc,
  type SoundcheckInputs,
} from "./index";

const CHANNEL = "UC-BHlgFbFh3V76yth-XCmlw";
const ID = "8f14e45fceea167a5a36dedd4bea2543";
const AT = "2026-10-13T09:00:00.000Z";
const VIDEO = "lgxOjPdCGkw";

const curve = (start: number) => Array.from({ length: 100 }, (_, i) => start - 0.006 * i);
const percentiles = (p50: number) => ({ p10: p50 - 5, p50, p90: p50 + 5 });
const model = {
  runId: "0c1f3fcc1600421db60ca923584a659b",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 20 are needed"],
  trainedVideos: 3,
};
const audience = {
  band: { p10: curve(0.85), p50: curve(0.9), p90: curve(0.95) },
  avdS: percentiles(96),
  avp: percentiles(40),
  model,
};
const prediction = {
  audiences: { subscribed: audience, unsubscribed: audience },
  weights: { subscribed: 0.2, unsubscribed: 0.8 },
  avdS: percentiles(96),
  avp: percentiles(40),
  percentileVsChannel: 62,
  comparedVideos: 3,
};

const awaiting = (): SoundcheckDoc => ({
  soundcheckId: ID,
  channelId: CHANNEL,
  status: "awaiting_upload",
  title: "",
  scenario: "recent",
  input: {
    kind: "file",
    fileName: "rough cut v3.mov",
    contentType: "video/quicktime",
    sizeBytes: 900_000_000,
    uri: `gs://soundcheck-uploads/${CHANNEL}/${ID}/source.mov`,
  },
  progress: null,
  error: null,
  durationS: null,
  beats: null,
  visualAssumed: false,
  prediction: null,
  edits: [],
  narrative: null,
  extractionVersion: "beats-v3",
  featureVersion: "f1",
  createdAt: AT,
  updatedAt: AT,
});

const ready = (): SoundcheckDoc => ({
  ...awaiting(),
  status: "ready",
  title: "How I built a guitar",
  scenario: "search",
  input: { kind: "script", text: "Hey everyone. Today we build a guitar from scratch." },
  durationS: 240,
  beats: [
    {
      startS: 0,
      endS: 240,
      beatType: "hook",
      visual: "none",
      talkingHeadShare: 5,
      summary: "The idea.",
      transcriptExcerpt: "Hey everyone.",
    },
  ],
  visualAssumed: true,
  prediction,
  narrative: "Newcomers from search should stay longer than usual.",
});

describe("soundcheck links and uploads", () => {
  it("finds the video ID in every kind of YouTube link", () => {
    for (const link of [
      VIDEO,
      `https://www.youtube.com/watch?v=${VIDEO}`,
      `https://youtube.com/watch?feature=share&v=${VIDEO}&t=42s`,
      `m.youtube.com/watch?v=${VIDEO}`,
      `https://youtu.be/${VIDEO}?si=abc`,
      `https://www.youtube.com/shorts/${VIDEO}`,
      `https://www.youtube.com/live/${VIDEO}?feature=shared`,
      `https://www.youtube.com/embed/${VIDEO}`,
      `  https://youtu.be/${VIDEO}  `,
    ]) {
      expect(parseYouTubeLink(link), link).toBe(VIDEO);
    }
  });

  it("rejects anything that is not a YouTube video", () => {
    for (const link of [
      "",
      "hello",
      `https://vimeo.com/${VIDEO}`,
      `https://www.youtube.com/@${VIDEO}`,
      "https://www.youtube.com/watch?v=short",
      `https://youtube.com.evil.example/watch?v=${VIDEO}`,
      `https://www.youtube.com/playlist?list=${VIDEO}`,
      "https://[::1",
    ]) {
      expect(parseYouTubeLink(link), link).toBeNull();
    }
  });

  it("stores an upload under its channel and soundcheck, and reads that back", () => {
    const name = uploadObjectName(CHANNEL, ID, "video/quicktime");
    expect(name).toBe(`${CHANNEL}/${ID}/source.mov`);
    expect(parseUploadObjectName(name)).toEqual({ channelId: CHANNEL, soundcheckId: ID });
    expect(parseUploadObjectName(`${CHANNEL}/probe/sample.mp4`)).toBeNull();
    expect(parseUploadObjectName(`${CHANNEL}/${ID}/source.avi`)).toBeNull();
    expect(parseUploadObjectName(`x/${CHANNEL}/${ID}/source.mp4`)).toBeNull();
  });

  it("keeps a channel's soundchecks under the channel", () => {
    const paths = soundcheckPaths(CHANNEL);
    expect(paths.soundcheck(ID)).toBe(`channels/${CHANNEL}/soundchecks/${ID}`);
    expect(paths.inputs(ID)).toBe(`channels/${CHANNEL}/soundchecks/${ID}/inputs/current`);
  });

  it("labels every traffic scenario", () => {
    expect(Object.keys(SCENARIO_LABELS)).toEqual(scenarioSchema.options);
  });
});

describe("soundcheck documents", () => {
  it("accept a file awaiting its upload and a finished script", () => {
    expect(soundcheckDocSchema.parse(awaiting())).toEqual(awaiting());
    expect(soundcheckDocSchema.parse(ready())).toEqual(ready());
  });

  it("refuse files over 2 GB, and types or IDs they do not know", () => {
    const tooBig = awaiting();
    if (tooBig.input.kind === "file") tooBig.input.sizeBytes = SOUNDCHECK_LIMITS.maxUploadBytes + 1;
    expect(soundcheckDocSchema.safeParse(tooBig).success).toBe(false);
    expect(
      soundcheckDocSchema.safeParse({
        ...awaiting(),
        input: { ...awaiting().input, contentType: "video/x-msvideo" },
      }).success,
    ).toBe(false);
    expect(
      soundcheckDocSchema.safeParse({ ...awaiting(), soundcheckId: "../../users/x" }).success,
    ).toBe(false);
  });

  it("tie the status to what the document holds", () => {
    // Failed exactly when there is an error.
    expect(soundcheckDocSchema.safeParse({ ...awaiting(), status: "failed" }).success).toBe(false);
    expect(
      soundcheckDocSchema.safeParse({
        ...awaiting(),
        status: "failed",
        error: { code: "private_video", message: "This video is private." },
      }).success,
    ).toBe(true);
    expect(
      soundcheckDocSchema.safeParse({
        ...ready(),
        error: { code: "internal", message: "Something broke." },
      }).success,
    ).toBe(false);
    // Ready only with a prediction; only a file waits for an upload.
    expect(soundcheckDocSchema.safeParse({ ...ready(), prediction: null }).success).toBe(false);
    expect(
      soundcheckDocSchema.safeParse({
        ...awaiting(),
        input: { kind: "youtube", videoId: VIDEO },
      }).success,
    ).toBe(false);
  });

  it("need weights that sum to 1, a compared percentile, and at least one audience", () => {
    expect(soundcheckPredictionSchema.safeParse(prediction).success).toBe(true);
    expect(
      soundcheckPredictionSchema.safeParse({
        ...prediction,
        weights: { subscribed: 0.5, unsubscribed: 0.6 },
      }).success,
    ).toBe(false);
    expect(soundcheckPredictionSchema.safeParse({ ...prediction, comparedVideos: 0 }).success).toBe(
      false,
    );
    expect(
      soundcheckPredictionSchema.safeParse({
        ...prediction,
        percentileVsChannel: null,
        comparedVideos: 0,
      }).success,
    ).toBe(true);
    expect(soundcheckPredictionSchema.safeParse({ ...prediction, audiences: {} }).success).toBe(
      false,
    );
  });

  it("cap scripts and titles", () => {
    const longScript = {
      ...ready(),
      input: { kind: "script", text: "a".repeat(SOUNDCHECK_LIMITS.maxScriptChars + 1) },
    };
    expect(soundcheckDocSchema.safeParse(longScript).success).toBe(false);
    expect(soundcheckDocSchema.safeParse({ ...ready(), title: "t".repeat(101) }).success).toBe(
      false,
    );
    expect(
      soundcheckDocSchema.safeParse({ ...ready(), input: { kind: "script", text: "   " } }).success,
    ).toBe(false);
  });
});

describe("soundcheck inputs", () => {
  const beat = {
    startS: 0,
    endS: 120,
    beatType: "explanation" as const,
    talkingHeadShare: 4,
    visual: "none" as const,
    cutsPerMin: 3,
    onScreenText: false,
    music: "none" as const,
    energy: 3,
    assumedKnowledge: 2,
    infoDensity: 3,
    opensLoop: false,
    closesLoop: false,
    speaks: true,
    wordsPerMinute: 150,
  };
  const inputs = (): SoundcheckInputs => ({
    soundcheckId: ID,
    channelId: CHANNEL,
    durationS: 240,
    video: { format: "tutorial", targetLevel: 2, payoffTimeS: null },
    beats: [beat, { ...beat, startS: 120, endS: 240, speaks: false }],
    channel: { medianTargetLevel: 2, mixMean: { search: 0.2, suggested: 0.5, browse: 0.2 } },
    scenario: "recent",
    mix: { search: 0.2, suggested: 0.5, browse: 0.2 },
    weights: { subscribed: 0.2, unsubscribed: 0.8 },
    models: {
      unsubscribed: {
        artifactUri: "gs://soundcheck-media/models/m.json",
        inflation: 1,
        stamp: model,
      },
    },
    seed: 20261013,
    visualPool: {
      explanation: [
        { talkingHeadShare: 4, visual: "b_roll", cutsPerMin: 6, onScreenText: true, music: "none" },
      ],
    },
    createdAt: AT,
  });

  it("accept a cut as the model reads it", () => {
    expect(soundcheckInputsSchema.parse(inputs())).toEqual(inputs());
  });

  it("refuse beats past the end, a cut with no model, or an empty pool", () => {
    expect(
      soundcheckInputsSchema.safeParse({ ...inputs(), beats: [{ ...beat, endS: 300 }] }).success,
    ).toBe(false);
    expect(soundcheckInputsSchema.safeParse({ ...inputs(), models: {} }).success).toBe(false);
    expect(
      soundcheckInputsSchema.safeParse({ ...inputs(), visualPool: { explanation: [] } }).success,
    ).toBe(false);
  });
});
