import { getChannel, getSummary, getVideo, listVideos } from "@soundcheck/core/data";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { GET as channel } from "./route";
import { GET as summary } from "./summary/route";
import { GET as videos } from "./videos/route";
import { GET as video } from "./videos/[videoId]/route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@soundcheck/core/data", () => ({
  getChannel: vi.fn(async () => ({ id: "channel" })),
  getSummary: vi.fn(async () => ({ headline: "summary" })),
  listVideos: vi.fn(async () => ({ videos: [] })),
  getVideo: vi.fn(async () => ({ videoId: "video" })),
}));

const USER = "111111111111111111111";
const ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const VIDEO = "lgxOjPdCGkw";
const request = new Request("http://localhost:3000/api/v1/channels");
const params = <T>(value: T) => ({ params: Promise.resolve(value) });

describe("GET /api/v1/channels/[id]/…", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("reads each screen's document as the signed-in user, with the right cache rule", async () => {
    vi.mocked(auth as unknown as () => Promise<{ userId: string }>).mockResolvedValue({
      userId: USER,
    });
    const cases = [
      [await channel(request, params({ id: ID })), getChannel, [USER, ID], "no-store"],
      [await summary(request, params({ id: ID })), getSummary, [USER, ID], "private, max-age=30"],
      [await videos(request, params({ id: ID })), listVideos, [USER, ID], "private, max-age=30"],
      [
        await video(request, params({ id: ID, videoId: VIDEO })),
        getVideo,
        [USER, ID, VIDEO],
        "private, max-age=30",
      ],
    ] as const;
    for (const [response, load, args, cache] of cases) {
      expect(response.status).toBe(200);
      expect(load).toHaveBeenCalledWith(...args);
      expect(response.headers.get("cache-control")).toBe(cache);
    }
  });
});
