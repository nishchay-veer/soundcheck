import { InvalidEditsError, NotFoundError, SoundcheckNotReadyError } from "@soundcheck/core";
import { simulateSoundcheck } from "@soundcheck/core/data";
import type { Simulation } from "@soundcheck/core/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@soundcheck/core/data", () => ({ simulateSoundcheck: vi.fn() }));

const CHANNEL_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const ID = "8f14e45fceea167a5a36dedd4bea2543";
const USER = "111111111111111111111";
const mockAuth = vi.mocked(auth as unknown as () => Promise<{ userId?: string } | null>);
const flat = (value: number) => Array.from({ length: 100 }, () => value);
const percentiles = (p50: number) => ({ p10: p50 - 1, p50, p90: p50 + 1 });
const simulation: Simulation = {
  durationS: 190,
  audiences: {
    unsubscribed: {
      band: { p10: flat(0.4), p50: flat(0.5), p90: flat(0.6) },
      avdS: percentiles(80),
      avp: percentiles(42),
    },
  },
  avdS: percentiles(80),
  avp: percentiles(42),
  delta: { avdS: percentiles(9), avpPp: percentiles(13) },
  spans: [{ beat: 0, startS: 0, endS: 190, fromS: 0, toS: 240, edit: null }],
};

const post = (body: unknown) =>
  POST(
    new Request(`http://localhost:3000/api/v1/channels/${CHANNEL_ID}/soundchecks/${ID}/simulate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: CHANNEL_ID, soundcheckId: ID }) },
  );

describe("POST /api/v1/channels/[id]/soundchecks/[soundcheckId]/simulate", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await post({ edits: [] })).status).toBe(401);
    expect(simulateSoundcheck).not.toHaveBeenCalled();
  });

  it("simulates the edits for the signed-in owner, never cached", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(simulateSoundcheck).mockResolvedValue(simulation);
    const response = await post({ edits: [{ op: "remove", beat: 2 }] });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(simulation);
    expect(simulateSoundcheck).toHaveBeenCalledWith(USER, CHANNEL_ID, ID, {
      edits: [{ op: "remove", beat: 2 }],
    });
  });

  it("answers 400 to a body it cannot read, before simulating", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    for (const body of [
      "not json",
      { edits: [{ op: "cut", beat: 1 }] },
      { edits: [{ op: "trim", beat: 1, keep: 2 }] },
      { edits: Array.from({ length: 31 }, (_, beat) => ({ op: "remove", beat })) },
    ]) {
      const response = await post(body);
      expect([response.status, await response.json()]).toEqual([400, { error: "invalid_request" }]);
    }
    expect(simulateSoundcheck).not.toHaveBeenCalled();
  });

  it.each([
    [new NotFoundError("soundcheck"), 404, { error: "not_found" }],
    [new SoundcheckNotReadyError(ID), 409, { error: "not_ready" }],
    [
      new InvalidEditsError("Beat 1 has two edits"),
      400,
      { error: "invalid_edits", message: "Beat 1 has two edits" },
    ],
  ])("maps %s to %i", async (error, status, body) => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(simulateSoundcheck).mockRejectedValue(error);
    const response = await post({ edits: [] });
    expect([response.status, await response.json()]).toEqual([status, body]);
  });
});
