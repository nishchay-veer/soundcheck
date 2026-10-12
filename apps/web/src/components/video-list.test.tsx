// @vitest-environment jsdom
import type { VideoListItem } from "@soundcheck/core/schemas";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VideoList } from "./video-list";

// next/image needs Next's image settings, and these tests never look at thumbnails.
vi.mock("next/image", () => ({ default: () => null }));

afterEach(cleanup);

const video = (
  videoId: string,
  title: string,
  publishedAt: string,
  extra: Partial<VideoListItem> = {},
): VideoListItem => ({
  videoId,
  title,
  publishedAt,
  durationS: 120,
  thumbnailUrl: null,
  avgViewPct: 40,
  biggestDrop: null,
  inSample: true,
  ...extra,
});
const VIDEOS = [
  video("aaaaaaaaaaa", "An old cover", "2026-01-01T00:00:00.000Z", {
    avgViewPct: 30,
    durationS: 300,
  }),
  video("bbbbbbbbbbb", "A new cover", "2026-09-01T00:00:00.000Z", {
    avgViewPct: 55,
    biggestDrop: { audience: "unsubscribed", atS: 272, lossPp: 12.2 },
  }),
  video("ccccccccccc", "A talk", "2026-05-01T00:00:00.000Z", {
    avgViewPct: 45,
    inSample: false,
    biggestDrop: { audience: "subscribed", atS: 3, lossPp: 30 },
  }),
];

const titles = () =>
  screen.getAllByRole("listitem").map((item) => within(item).getByRole("link").textContent ?? "");
const order = () => titles().map((text) => VIDEOS.find((v) => text.includes(v.title))?.title);

describe("VideoList", () => {
  it("lists the newest first, each linking to its autopsy, with its biggest drop-off", () => {
    render(<VideoList videos={VIDEOS} />);
    expect(order()).toEqual(["A new cover", "A talk", "An old cover"]);
    const link = screen.getByRole("link", { name: /A new cover/ });
    expect(link.getAttribute("href")).toBe("/app/videos/bbbbbbbbbbb");
    expect(link.textContent).toContain("Biggest drop at 4:32");
    expect(link.textContent).toContain("newcomers, 12.2 points");
    expect(screen.getByRole("link", { name: /An old cover/ }).textContent).toContain(
      "No clear drop-off",
    );
  });

  it("marks a video the model never trained on", () => {
    render(<VideoList videos={VIDEOS} />);
    expect(screen.getByRole("link", { name: /A talk/ }).textContent).toContain("Held out");
    expect(screen.getByRole("link", { name: /A new cover/ }).textContent).not.toContain("Held out");
  });

  it("sorts and searches on the page", () => {
    render(<VideoList videos={VIDEOS} />);
    const sort = screen.getByRole("combobox", { name: "Sort" });
    fireEvent.change(sort, { target: { value: "watched" } });
    expect(order()).toEqual(["A new cover", "A talk", "An old cover"]);
    fireEvent.change(sort, { target: { value: "drop" } });
    expect(order()).toEqual(["A talk", "A new cover", "An old cover"]);
    fireEvent.change(sort, { target: { value: "longest" } });
    expect(order()[0]).toBe("An old cover");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search titles" }), {
      target: { value: "COVER" },
    });
    expect(order()).toEqual(["An old cover", "A new cover"]);
    expect(screen.getByText("2 of 3 videos")).toBeTruthy();
    fireEvent.change(screen.getByRole("searchbox", { name: "Search titles" }), {
      target: { value: "zzz" },
    });
    expect(screen.getByText(/No video title contains/)).toBeTruthy();
  });
});
