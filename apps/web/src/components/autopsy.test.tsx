// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { videoDocSchema, type Drop, type VideoDoc } from "@soundcheck/core/schemas";
import { TooltipProvider } from "@soundcheck/ui/components/tooltip";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useImperativeHandle, type Ref } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_CARDS } from "@/app/styleguide/samples";
import { AudienceGrid } from "./audience-grid";
import { DropPanel } from "./drop-panel";
import { VideoAutopsy } from "./video-autopsy";
import type { PlayerHandle } from "./youtube-player";

const seekTo = vi.fn();
// The real player loads YouTube's script; this one records where it is sent.
vi.mock("./youtube-player", () => ({
  YouTubePlayer: ({ ref }: { ref?: Ref<PlayerHandle> }) => {
    useImperativeHandle(ref, () => ({ seekTo }), []);
    return <div data-testid="player" />;
  },
}));

afterEach(() => {
  cleanup();
  seekTo.mockReset();
});

const video = (): VideoDoc =>
  videoDocSchema.parse(
    JSON.parse(
      readFileSync(
        join(process.cwd(), "fixtures/channels/UC-BHlgFbFh3V76yth-XCmlw/videos/lgxOjPdCGkw.json"),
        "utf8",
      ),
    ),
  );

const drop = (extra: Partial<Drop> = {}): Drop => ({
  audience: "unsubscribed",
  startS: 72,
  endS: 80,
  binStart: 28,
  binEnd: 30,
  actualLossPp: 6.43,
  attributions: [
    { group: "sponsor", label: "Sponsor segment", share: 0.55 },
    { group: "position", label: "Position in video", share: 0.15 },
  ],
  residualShare: 0.3,
  narrative: "From 1:12 to 1:20, you lost 6.4 percent of the newcomers who started.",
  ...extra,
});
const notUsable = {
  runId: "r",
  usable: false,
  unusableReasons: ["trained on 3 videos; at least 30 are needed"],
  trainedVideos: 3,
};

describe("DropPanel", () => {
  it("explains a drop-off with linked causes and the unexplained rest", () => {
    render(<DropPanel drop={drop()} model={notUsable} />);
    expect(
      screen.getByRole("heading", { name: "Why 6.4% of newcomers left at 1:12" }),
    ).toBeTruthy();
    expect(screen.getByText(/you lost 6.4 percent/)).toBeTruthy();
    expect(
      screen.getByText(
        "The model links 55% of this drop to the sponsor segment and 15% to its position in the video. It can't explain the other 30%.",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("link", {
          name: "Sponsor segment 55% (see this effect on the audiences screen)",
        })
        .getAttribute("href"),
    ).toBe("/app/audiences?audience=unsubscribed&effect=beat_sponsor");
    expect(screen.queryByRole("link", { name: /Position in video/ })).toBeNull();
    expect(screen.getByText("Position in video")).toBeTruthy();
    expect(screen.getByText("Unexplained").parentElement?.textContent).toBe("Unexplained30%");
    expect(screen.getByText("Not a result yet")).toBeTruthy();
  });

  it("keeps the unexplained chip when it is everything, and says when there is no drop-off", () => {
    render(<DropPanel drop={drop({ attributions: [], residualShare: 1 })} model={null} />);
    expect(screen.getByText("Unexplained").parentElement?.textContent).toBe("Unexplained100%");
    expect(screen.getByText("The model can't explain this drop yet.")).toBeTruthy();
    cleanup();
    render(<DropPanel drop={null} model={null} />);
    expect(screen.getByRole("heading", { name: "No clear drop-offs" })).toBeTruthy();
  });

  it("explains each chip in a note behind its question mark", async () => {
    const user = userEvent.setup();
    render(<DropPanel drop={drop()} model={notUsable} />);
    await user.click(screen.getByRole("button", { name: 'What "Position in video" means' }));
    expect(screen.getByRole("dialog").textContent).toMatch(/^Viewers leave faster at the start/);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: 'What "Unexplained" means' }));
    expect(screen.getByRole("dialog").textContent).toMatch(/can't link to anything it measures/);
    expect(screen.getAllByRole("button", { name: /^What ".+" means$/ })).toHaveLength(3);
  });
});

describe("VideoAutopsy", () => {
  it("opens on the largest drop-off, and seeks the player to each one selected", () => {
    render(<VideoAutopsy video={video()} />);
    expect(
      screen.getByRole("heading", { name: "Why 41.9% of newcomers left at 0:03" }),
    ).toBeTruthy();
    const chart = screen.getByRole("group", { name: /arrow keys/ });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    const [first] = seekTo.mock.calls.at(-1) ?? [];
    expect(first).toBeGreaterThan(2.6);
    expect(screen.getByRole("heading", { level: 2 }).textContent).toMatch(/^Why .* left at /);
    // Clicking a drop-off's band selects it and seeks to its start.
    const band = document.querySelector('[data-drop="subscribed:16"]') as Element;
    fireEvent.click(band);
    expect(seekTo).toHaveBeenLastCalledWith(39.3);
    expect(
      screen.getByRole("heading", { name: "Why 11.1% of subscribers left at 0:39" }),
    ).toBeTruthy();
  });
});

describe("AudienceGrid deep link", () => {
  // Browsers scroll the linked effect into view; jsdom has no scrolling.
  Element.prototype.scrollIntoView = vi.fn();

  it("opens the linked audience's sheet at the linked effect", () => {
    render(
      <TooltipProvider>
        <AudienceGrid
          cards={SAMPLE_CARDS}
          focus={{ audience: "subscribed", effect: "beat_sponsor" }}
        />
      </TooltipProvider>,
    );
    const sheet = screen.getByRole("dialog", { name: "Subscribers: every effect" });
    const highlighted = sheet.querySelector('[aria-current="true"]') as HTMLElement;
    expect(within(highlighted).getByText("A 30 s sponsor read at 30%")).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("opens nothing for an audience or effect it does not know", async () => {
    render(
      <TooltipProvider>
        <AudienceGrid cards={SAMPLE_CARDS} focus={{ audience: "nobody", effect: "beat_sponsor" }} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    await userEvent.click(
      screen.getAllByRole("button", { name: /See every effect/ })[0] as HTMLElement,
    );
    expect(screen.getByRole("dialog").querySelector('[aria-current="true"]')).toBeNull();
  });
});
