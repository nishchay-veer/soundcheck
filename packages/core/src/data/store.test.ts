import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixturesMode, resetEnvCache } from "../env";
import { FixturesModeError } from "../errors";
import { resetClients, setClientOverride } from "../gcp";
import { deleteChannel } from "./delete-channel";
import { startChannelBuild } from "./build";
import { getSummary } from "./screens";
import { FIXTURE_USER_ID, fixturePath, fromFixture, readDocument, toFixture } from "./store";

const CHANNEL = "UC-BHlgFbFh3V76yth-XCmlw";

describe("fixture files", () => {
  it("keep timestamps as dates through JSON", () => {
    const at = new Date("2026-10-06T10:00:00Z");
    const timestamp = { toDate: () => at, seconds: 1 };
    const text = JSON.stringify(
      toFixture({ connectedAt: timestamp, build: { startedAt: at }, n: [1, "a"] }),
    );
    expect(text).toBe(
      '{"connectedAt":{"$date":"2026-10-06T10:00:00.000Z"},"build":{"startedAt":{"$date":"2026-10-06T10:00:00.000Z"}},"n":[1,"a"]}',
    );
    expect(fromFixture(text)).toEqual({ connectedAt: at, build: { startedAt: at }, n: [1, "a"] });
  });

  it("live at document paths only", () => {
    vi.stubEnv("FIXTURES_DIR", "/fixtures");
    expect(fixturePath(`channels/${CHANNEL}/summary/current`)).toBe(
      `/fixtures/channels/${CHANNEL}/summary/current.json`,
    );
    for (const path of ["channels", "channels/../users/x", "channels/a/b", "/etc/passwd"]) {
      expect(() => fixturePath(path)).toThrow(/Not a document path/);
    }
    vi.unstubAllEnvs();
  });
});

describe("fixtures mode", () => {
  let dir: string;

  const save = async (path: string, data: unknown) => {
    const file = join(dir, `${path}.json`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(toFixture(data)));
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "fixtures-"));
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "true");
    vi.stubEnv("FIXTURES_DIR", dir);
    // Firestore must never be touched.
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
    await save(`channels/${CHANNEL}`, {
      userId: FIXTURE_USER_ID,
      title: "Fixture channel",
      thumbnailUrl: null,
      subscriberCount: 120,
      videoCount: 4,
      uploadsPlaylistId: "UU-BHlgFbFh3V76yth-XCmlw",
      status: "connected",
      tokenCiphertext: "fixture",
      tokenScope: "",
      connectedAt: new Date("2026-10-06T10:00:00Z"),
      build: { state: "ready" },
    });
    await save(`channels/${CHANNEL}/summary/current`, {
      channelId: CHANNEL,
      runId: "pub1",
      generatedAt: "2026-10-11T09:00:00.000Z",
      videosAnalysed: 3,
      beatsExtracted: 20,
      evaluation: null,
      headline: "A headline.",
      audiences: [],
    });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetEnvCache();
    resetClients();
    await rm(dir, { recursive: true, force: true });
  });

  it("reads the saved documents for the fixture user, without Firestore", async () => {
    expect(fixturesMode()).toBe(true);
    expect((await getSummary(FIXTURE_USER_ID, CHANNEL))?.headline).toBe("A headline.");
    expect(await readDocument(`channels/${CHANNEL}/index/videos`)).toBeUndefined();
  });

  it("never writes", async () => {
    await expect(startChannelBuild(CHANNEL)).rejects.toThrow(FixturesModeError);
    await expect(deleteChannel(FIXTURE_USER_ID, CHANNEL)).rejects.toThrow(FixturesModeError);
  });

  it("refuses to run in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(() => fixturesMode()).toThrow(/must not be set in production/);
  });
});
