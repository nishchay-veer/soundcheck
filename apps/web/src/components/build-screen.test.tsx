// @vitest-environment jsdom
import type { ChannelView } from "@soundcheck/core/schemas";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BuildScreen, POLL_MS } from "./build-screen";

const ID = "UC-BHlgFbFh3V76yth-XCmlw";
const channel = (build: ChannelView["build"]): ChannelView => ({
  id: ID,
  title: "A channel",
  thumbnailUrl: null,
  subscriberCount: 48,
  videoCount: 4,
  status: "connected",
  connectedAt: "2026-10-06T10:00:00.000Z",
  build,
});

/** The API: answers GET with the queued builds in turn (repeating the last), POST with `post`. */
function api(
  builds: ChannelView["build"][],
  post: { status: number; body?: unknown } = { status: 202 },
) {
  const gets: string[] = [];
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST")
      return new Response(JSON.stringify(post.body ?? {}), { status: post.status });
    gets.push(url);
    const build = builds[Math.min(gets.length - 1, builds.length - 1)] as ChannelView["build"];
    return new Response(JSON.stringify(channel(build)), { status: 200 });
  });
  vi.stubGlobal("fetch", fetch);
  return { fetch, gets };
}

const show = (
  build: ChannelView["build"],
  props: Partial<Parameters<typeof BuildScreen>[0]> = {},
) =>
  render(
    // jsdom reports the page as hidden, where SWR would rightly stop polling.
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, refreshWhenHidden: true }}>
      <BuildScreen
        initial={channel(build)}
        hasPreview={false}
        minVideos={30}
        minViews={200}
        {...props}
      />
    </SWRConfig>,
  );

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("BuildScreen", () => {
  it("shows live progress while running, and stops asking once the build is ready", async () => {
    const { gets } = api([
      {
        state: "running",
        stage: "extract",
        progress: {
          stage: "extract",
          done: 12,
          total: 40,
          etaS: 250,
          updatedAt: "2026-10-12T09:00:00.000Z",
        },
      },
      { state: "ready", stage: "publish" },
    ]);
    show({ state: "running", stage: "ingest" });
    expect(screen.getByRole("heading", { name: "Learning how your audiences watch" })).toBeTruthy();
    expect(screen.getByText(/you can close\s+this tab/i)).toBeTruthy();

    // The first answer, fetched on load: the build has reached the beats.
    expect(await screen.findByText(/12 of 40/)).toBeTruthy();
    expect(screen.getByText("about 4 minutes left")).toBeTruthy();
    expect(
      screen
        .getByRole("progressbar", { name: "Watching your videos" })
        .getAttribute("aria-valuenow"),
    ).toBe("30");

    await act(() => vi.advanceTimersByTimeAsync(POLL_MS + 50));
    expect(await screen.findByRole("heading", { name: "Your audiences are ready" })).toBeTruthy();
    const asked = gets.length;
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 3));
    expect(gets.length).toBe(asked);
  });

  it("says where a build failed and starts it again", async () => {
    const { fetch } = api([{ state: "queued" }]);
    show({
      state: "failed",
      stage: "train",
      error: "train: Task job-train-x failed with exit code: 1",
    });
    expect(screen.getByText(/while learning your audiences/)).toBeTruthy();
    expect(screen.getByText(/Details: train: Task job-train-x failed/)).toBeTruthy();
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Try again" }));
    expect(fetch).toHaveBeenCalledWith(`/api/v1/channels/${ID}/build`, { method: "POST" });
    expect(
      await screen.findByRole("heading", { name: "Learning how your audiences watch" }),
    ).toBeTruthy();
  });

  it("explains a channel with too few videos, and offers the preview only when one exists", () => {
    api([{ state: "insufficient_data", stage: "ingest", eligibleVideos: 3, usableVideos: 3 }]);
    const build = {
      state: "insufficient_data",
      stage: "ingest",
      eligibleVideos: 3,
      usableVideos: 3,
    } as const;
    show(build);
    expect(screen.getByText(/Soundcheck needs at least/).textContent).toMatch(
      /at least 30 videos .* Your channel has 3 of 3 eligible videos/,
    );
    expect(screen.queryByRole("link", { name: "See the preview anyway" })).toBeNull();
    cleanup();
    show(build, { hasPreview: true });
    expect(screen.getByRole("link", { name: "See the preview anyway" }).getAttribute("href")).toBe(
      "/app/audiences",
    );
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("explains why a build could not start", async () => {
    api([{ state: "not_started" }], { status: 503, body: { error: "fixtures_mode" } });
    show({ state: "not_started" });
    await userEvent
      .setup({ advanceTimers: vi.advanceTimersByTime })
      .click(screen.getByRole("button", { name: "Start" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "fixture data, which is read-only",
    );
  });
});
