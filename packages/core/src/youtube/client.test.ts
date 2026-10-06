import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseMyChannel } from "./client";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../../tests/fixtures/youtube/channels.list.mine.json", import.meta.url),
    "utf8",
  ),
) as { items: Array<Record<string, Record<string, unknown>>> };

const withStatistics = (statistics: Record<string, unknown>) => ({
  items: [{ ...fixture.items[0], statistics }],
});

describe("parseMyChannel", () => {
  it("reads the channel from a channels.list response", () => {
    expect(parseMyChannel(fixture)).toEqual({
      id: "UCaBcDeFgHiJkLmNoPqRsTuV",
      title: "Fixture Channel",
      thumbnailUrl: "https://yt3.ggpht.com/fixture=s800",
      subscriberCount: 8450,
      videoCount: 64,
      uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
    });
  });

  it("returns null when the account has no channel", () => {
    expect(parseMyChannel({ kind: "youtube#channelListResponse", items: [] })).toBeNull();
    expect(parseMyChannel({ kind: "youtube#channelListResponse" })).toBeNull();
  });

  it("reports a hidden subscriber count as null", () => {
    const parsed = parseMyChannel(
      withStatistics({ hiddenSubscriberCount: true, subscriberCount: "0", videoCount: "3" }),
    );
    expect(parsed?.subscriberCount).toBeNull();
    expect(parsed?.videoCount).toBe(3);
  });

  it("rejects a response missing the uploads playlist", () => {
    const [channel] = fixture.items;
    expect(() => parseMyChannel({ items: [{ ...channel, contentDetails: {} }] })).toThrow();
  });
});
