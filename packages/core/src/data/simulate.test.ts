import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { InvalidEditsError, NotFoundError, SoundcheckNotReadyError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { loadArtifact } from "../model";
import {
  soundcheckPaths,
  type ChannelDoc,
  type FeatureBeatInput,
  type ModelArtifact,
  type SoundcheckInputs,
} from "../schemas";
import { resetSimulationCache, simulateSoundcheck } from "./simulate";
import { FIXTURE_USER_ID, toFixture } from "./store";

const ME = "111111111111111111111";
const OTHER = "222222222222222222222";
const CHANNEL = "UC-BHlgFbFh3V76yth-XCmlw";
const ID = "8f14e45fceea167a5a36dedd4bea2543";
const paths = soundcheckPaths(CHANNEL);
const URIS = {
  subscribed: "gs://test-raw/models/sub.json",
  unsubscribed: "gs://test-raw/models/new.json",
};

const base = loadArtifact(
  JSON.parse(
    readFileSync(
      new URL("../../../../tests/fixtures/parity/artifact.json", import.meta.url),
      "utf8",
    ),
  ),
);
/** A made-up model: tangents make viewers leave much faster, energy keeps them. */
const model = (audience: "subscribed" | "unsubscribed", tangent: number): ModelArtifact => ({
  ...base,
  audience,
  featureNames: ["pos_b1", "beat_tangent", "energy"],
  droppedFeatures: [],
  unpenalized: ["pos_b1"],
  mean: [0, 0, 3],
  sd: [1, 1, 1],
  alpha: -4,
  beta: [0.2, tangent, -0.3],
  cov: [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 0.002 : 0))),
});

const beat = (
  startS: number,
  endS: number,
  beatType: FeatureBeatInput["beatType"] = "explanation",
): FeatureBeatInput => ({
  startS,
  endS,
  beatType,
  talkingHeadShare: 3,
  visual: "b_roll",
  cutsPerMin: 10,
  onScreenText: false,
  music: "none",
  energy: 3,
  assumedKnowledge: 2,
  infoDensity: 3,
  opensLoop: false,
  closesLoop: false,
  speaks: true,
  wordsPerMinute: 150,
});
const stamp = {
  runId: "run1",
  usable: false,
  unusableReasons: ["trained on 3 videos"],
  trainedVideos: 3,
};
const inputs = (channelId = CHANNEL): SoundcheckInputs => ({
  soundcheckId: ID,
  channelId,
  durationS: 240,
  video: { format: "tutorial", targetLevel: 2, payoffTimeS: 160 },
  beats: [
    beat(0, 20, "hook"),
    beat(20, 80),
    beat(80, 130, "tangent"),
    beat(130, 160, "sponsor"),
    beat(160, 200, "payoff"),
    beat(200, 240, "outro"),
  ],
  channel: { medianTargetLevel: 2, mixMean: { search: 0.2, suggested: 0.3, browse: 0.4 } },
  scenario: "recent",
  mix: { search: 0.3, suggested: 0.5, browse: 0.1 },
  weights: { subscribed: 0.25, unsubscribed: 0.75 },
  models: {
    subscribed: { artifactUri: URIS.subscribed, inflation: 1, stamp },
    unsubscribed: { artifactUri: URIS.unsubscribed, inflation: 1, stamp },
  },
  seed: 1,
  createdAt: "2026-10-14T09:00:00.000Z",
});
const channel = (userId = ME): ChannelDoc => ({
  userId,
  title: "A channel",
  thumbnailUrl: null,
  subscriberCount: 120,
  videoCount: 4,
  uploadsPlaylistId: "UU-BHlgFbFh3V76yth-XCmlw",
  status: "connected",
  tokenCiphertext: "c2VjcmV0",
  tokenScope: "openid",
  connectedAt: new Date("2026-10-06T10:00:00Z"),
  build: { state: "ready" },
});

describe("simulateSoundcheck", () => {
  let db: FakeFirestore;
  let storage: FakeStorage;
  const simulate = (
    edits: Parameters<typeof simulateSoundcheck>[3]["edits"] = [],
    userId = ME,
    id = ID,
  ) => simulateSoundcheck(userId, CHANNEL, id, { edits, objective: "avd" });

  beforeEach(async () => {
    resetSimulationCache();
    db = new FakeFirestore();
    storage = new FakeStorage();
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("storage", storage.asStorage());
    await db.doc(`channels/${CHANNEL}`).set(channel());
    await db.doc(paths.soundcheck(ID)).set({ soundcheckId: ID });
    await db.doc(paths.inputs(ID)).set(inputs());
    await storage
      .bucket("test-raw")
      .file("models/sub.json")
      .save(JSON.stringify(model("subscribed", 1)));
    await storage
      .bucket("test-raw")
      .file("models/new.json")
      .save(JSON.stringify(model("unsubscribed", 2)));
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("gives the cut as it is with no change", async () => {
    const result = await simulate();
    expect(result.durationS).toBe(240);
    expect(result.delta).toEqual({
      avdS: { p10: 0, p50: 0, p90: 0 },
      avpPp: { p10: 0, p50: 0, p90: 0 },
    });
    expect(result.spans.map((span) => [span.beat, span.edit])).toEqual(
      [0, 1, 2, 3, 4, 5].map((beat) => [beat, null]),
    );
    expect(result.audiences.unsubscribed?.band.p50).toHaveLength(100);
    expect(result.avp.p10).toBeLessThan(result.avp.p90);
  });

  it("predicts the edited cut on the same draws, with its new beats", async () => {
    const result = await simulate([{ op: "remove", beat: 2 }]);
    expect(result.durationS).toBe(190);
    expect(result.delta.avpPp.p10).toBeGreaterThan(0);
    expect(result.spans.map((span) => [span.beat, span.startS, span.endS])).toEqual([
      [0, 0, 20],
      [1, 20, 80],
      [3, 80, 110],
      [4, 110, 150],
      [5, 150, 190],
    ]);
    // The same edits give the same numbers.
    expect(await simulate([{ op: "remove", beat: 2 }])).toEqual(result);
  });

  it("keeps the models in memory between toggles", async () => {
    await simulate();
    await storage.bucket("test-raw").file("models/sub.json").delete();
    await storage.bucket("test-raw").file("models/new.json").delete();
    expect((await simulate([{ op: "trim", beat: 1, keep: 0.5 }])).durationS).toBe(210);
  });

  it("refuses edits that cannot go together", async () => {
    await expect(
      simulate([
        { op: "remove", beat: 1 },
        { op: "trim", beat: 1, keep: 0.5 },
      ]),
    ).rejects.toBeInstanceOf(InvalidEditsError);
    await expect(simulate([{ op: "remove", beat: 9 }])).rejects.toBeInstanceOf(InvalidEditsError);
  });

  it("answers only the owner, and says when there is nothing to simulate yet", async () => {
    await expect(simulate([], OTHER)).rejects.toBeInstanceOf(NotFoundError);
    await expect(simulate([], ME, "../../users/x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(simulate([], ME, "0".repeat(32))).rejects.toBeInstanceOf(NotFoundError);
    db.docs.delete(paths.inputs(ID));
    await expect(simulate()).rejects.toBeInstanceOf(SoundcheckNotReadyError);
  });

  it("works in fixtures mode, with the artifacts saved beside the documents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fixtures-"));
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "true");
    vi.stubEnv("FIXTURES_DIR", dir);
    resetEnvCache();
    setClientOverride(
      "firestore",
      new Proxy(
        {},
        {
          get: () => () => {
            throw new Error("Firestore was used");
          },
        },
      ) as never,
    );
    const save = async (path: string, data: unknown) => {
      await mkdir(join(dir, path, ".."), { recursive: true });
      await writeFile(join(dir, path), JSON.stringify(data));
    };
    await save(`channels/${CHANNEL}.json`, toFixture({ ...channel(FIXTURE_USER_ID) }));
    await save(`${paths.inputs(ID)}.json`, inputs());
    await save("storage/test-raw/models/sub.json", model("subscribed", 1));
    await save("storage/test-raw/models/new.json", model("unsubscribed", 2));
    const result = await simulateSoundcheck(FIXTURE_USER_ID, CHANNEL, ID, {
      edits: [{ op: "remove", beat: 2 }],
      objective: "avd",
    });
    expect(result.durationS).toBe(190);
  });
});
