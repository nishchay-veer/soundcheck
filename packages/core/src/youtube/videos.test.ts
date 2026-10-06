import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseUploadsPage, parseVideos, uploadsPageRequest, videosRequest } from "./videos";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/youtube/${name}`, import.meta.url), "utf8"),
  );

describe("requests", () => {
  it("pages the uploads playlist 50 at a time", () => {
    expect(uploadsPageRequest("UUx")).toEqual({
      part: ["snippet", "contentDetails"],
      playlistId: "UUx",
      maxResults: 50,
    });
    expect(uploadsPageRequest("UUx", "next")).toMatchObject({ pageToken: "next" });
  });

  it("asks videos.list for every part ingest stores, at most 50 IDs", () => {
    expect(videosRequest(["a", "b"])).toEqual({
      part: ["snippet", "contentDetails", "statistics", "status", "liveStreamingDetails"],
      id: ["a", "b"],
      maxResults: 50,
    });
    expect(() => videosRequest([])).toThrow(RangeError);
    expect(() => videosRequest(Array.from({ length: 51 }, (_, i) => `v${i}`))).toThrow(RangeError);
  });
});

describe("parseUploadsPage", () => {
  it("reads video IDs in playlist order from a recorded page", () => {
    expect(parseUploadsPage(fixture("playlistItems.list.uploads.json"))).toEqual({
      videoIds: ["fixtureVid1", "fixtureVid2", "fixtureVid3", "fixtureVid4"],
      nextPageToken: null,
    });
  });

  it("returns the next page token", () => {
    expect(parseUploadsPage({ items: [], nextPageToken: "EAAa" }).nextPageToken).toBe("EAAa");
  });
});

describe("parseVideos", () => {
  it("reads a recorded videos.list response", () => {
    const videos = parseVideos(fixture("videos.list.uploads.json"));
    expect(videos.map((video) => [video.id, video.durationS])).toEqual([
      ["fixtureVid1", 88],
      ["fixtureVid2", 31],
      ["fixtureVid3", 222],
      ["fixtureVid4", 262],
    ]);
    expect(videos[0]).toEqual({
      id: "fixtureVid1",
      title: "Fixture video 1",
      description: "",
      publishedAt: "2026-09-28T14:00:00Z",
      durationS: 88,
      viewCount: 1_234_567,
      isLive: false,
      categoryId: expect.any(String),
      tags: ["fixture tag"],
      thumbnailUrl: "https://i.ytimg.com/vi/fixtureVid1/default.jpg",
      language: "en",
      privacyStatus: "public",
    });
  });

  it("marks streams and premieres, and tolerates missing optional parts", () => {
    const [video] = parseVideos({
      items: [
        {
          id: "live1",
          snippet: {
            publishedAt: "2026-09-01T10:00:00Z",
            title: "A stream",
            defaultLanguage: "en",
            defaultAudioLanguage: "en-GB",
          },
          contentDetails: { duration: "P0D" },
          liveStreamingDetails: { actualStartTime: "2026-09-01T10:00:00Z" },
        },
      ],
    });
    expect(video).toMatchObject({
      isLive: true,
      durationS: 0,
      viewCount: 0,
      tags: [],
      thumbnailUrl: null,
      language: "en-GB",
      privacyStatus: null,
    });
  });

  it("returns nothing for deleted videos (missing items)", () => {
    expect(parseVideos({ kind: "youtube#videoListResponse", items: [] })).toEqual([]);
    expect(parseVideos({ kind: "youtube#videoListResponse" })).toEqual([]);
  });

  it("rejects an unparseable duration", () => {
    expect(() =>
      parseVideos({
        items: [
          {
            id: "x",
            snippet: { publishedAt: "2026-09-01T10:00:00Z", title: "x" },
            contentDetails: { duration: "P1M" },
          },
        ],
      }),
    ).toThrow(RangeError);
  });
});
