import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { resetClients, setClientOverride } from "../gcp";
import {
  servingPaths,
  type ChannelDoc,
  type SummaryDoc,
  type VideoDoc,
  type VideoIndexDoc,
} from "../schemas";
import { getChannel, getSummary, getVideo, listVideos } from "./screens";

const ME = "111111111111111111111";
const OTHER = "222222222222222222222";
const MINE = "UCaBcDeFgHiJkLmNoPqRsTuV";
const THEIRS = "UCzYxWvUtSrQpOnMlKjIhGfE";
const VIDEO = "lgxOjPdCGkw";
const AT = "2026-10-11T09:00:00.000Z";

const channel = (userId: string): ChannelDoc => ({
  userId,
  title: "A channel",
  thumbnailUrl: null,
  subscriberCount: 120,
  videoCount: 4,
  uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
  status: "connected",
  tokenCiphertext: "c2VjcmV0",
  tokenScope: "openid",
  connectedAt: new Date("2026-10-06T10:00:00Z"),
  build: { state: "ready", runId: "run1", finishedAt: new Date("2026-10-10T16:21:45Z") },
});

const summary = (channelId: string): SummaryDoc => ({
  channelId,
  runId: "pub1",
  generatedAt: AT,
  videosAnalysed: 1,
  beatsExtracted: 6,
  evaluation: null,
  headline: "Across 1 video, newcomers watch 41.3% of a video on average.",
  audiences: [],
});
const index = (channelId: string): VideoIndexDoc => ({
  channelId,
  runId: "pub1",
  generatedAt: AT,
  videos: [],
});
const video = (channelId: string): VideoDoc => ({
  channelId,
  videoId: VIDEO,
  runId: "pub1",
  generatedAt: AT,
  title: "A cover",
  publishedAt: "2026-08-01T12:00:00.000Z",
  durationS: 262,
  thumbnailUrl: null,
  stats: { views: 314, avdS: 96.5, avp: 36.9 },
  audiences: {},
  beats: [],
  drops: [],
  inSample: true,
});

describe("screen data functions", () => {
  let db: FakeFirestore;

  beforeEach(async () => {
    db = new FakeFirestore();
    setClientOverride("firestore", db.asFirestore());
    for (const [id, owner] of [
      [MINE, ME],
      [THEIRS, OTHER],
    ] as const) {
      const paths = servingPaths(id);
      await db.doc(`channels/${id}`).set(channel(owner));
      await db.doc(paths.summary).set(summary(id));
      await db.doc(paths.videoIndex).set(index(id));
      await db.doc(paths.video(VIDEO)).set(video(id));
    }
  });

  afterEach(() => {
    resetClients();
  });

  it("returns the channel and its documents, parsed", async () => {
    expect(await getChannel(ME, MINE)).toMatchObject({
      id: MINE,
      build: { state: "ready", finishedAt: "2026-10-10T16:21:45.000Z" },
    });
    expect(await getSummary(ME, MINE)).toEqual(summary(MINE));
    expect(await listVideos(ME, MINE)).toEqual(index(MINE));
    expect(await getVideo(ME, MINE, VIDEO)).toEqual(video(MINE));
  });

  it.each([
    ["getChannel", () => getChannel(ME, THEIRS)],
    ["getSummary", () => getSummary(ME, THEIRS)],
    ["listVideos", () => listVideos(ME, THEIRS)],
    ["getVideo", () => getVideo(ME, THEIRS, VIDEO)],
    ["getVideo with a bad video ID", () => getVideo(ME, THEIRS, "../x")],
  ])("%s blocks another user's channel", async (_name, call) => {
    await expect(call()).rejects.toThrow(NotFoundError);
  });

  it("answers null before the first publish, and 404 for a missing or malformed video", async () => {
    db.docs.delete(servingPaths(MINE).summary);
    db.docs.delete(servingPaths(MINE).videoIndex);
    expect(await getSummary(ME, MINE)).toBeNull();
    expect(await listVideos(ME, MINE)).toBeNull();
    await expect(getVideo(ME, MINE, "dQw4w9WgXcQ")).rejects.toThrow(NotFoundError);
    await expect(getVideo(ME, MINE, "../summary")).rejects.toThrow(NotFoundError);
    await expect(getSummary(ME, "../channels")).rejects.toThrow(NotFoundError);
  });

  it("refuses a document that does not match its contract", async () => {
    await db.doc(servingPaths(MINE).summary).set({ ...summary(MINE), headline: "" });
    await expect(getSummary(ME, MINE)).rejects.toThrow();
  });
});
