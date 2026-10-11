// @vitest-environment jsdom
import { TooltipProvider } from "@soundcheck/ui/components/tooltip";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_BEATS, SAMPLE_CARDS, SAMPLE_SERIES } from "@/app/styleguide/samples";
import { AudienceCard } from "./audience-card";
import { BeatStrip } from "./beat-strip";
import { EffectBar } from "./effect-bar";
import { KindBadge } from "./kind-badge";
import { ResultNotice } from "./result-notice";
import { RetentionChart } from "./retention-chart";

afterEach(cleanup);

const withTooltips = (node: React.ReactNode) => render(<TooltipProvider>{node}</TooltipProvider>);

describe("EffectBar", () => {
  it("shows a clear effect with its interval, and says when the interval crosses zero", () => {
    render(
      <>
        <EffectBar label="Payoff" delta={3.4} ci={[1.2, 5.6]} domain={6} />
        <EffectBar label="Tangent" delta={-0.6} ci={[-2.4, 1.1]} domain={6} />
        <EffectBar label="Call to action" delta={null} ci={null} domain={6} />
      </>,
    );
    expect(screen.getByText("+3.4 pp (1.2 to 5.6)")).toBeTruthy();
    expect(screen.getByText("−0.6 pp (−2.4 to 1.1)")).toBeTruthy();
    expect(screen.getAllByText("Can't tell yet")).toHaveLength(1);
    expect(screen.getByText("Not learned: it never varies in your videos")).toBeTruthy();
  });
});

describe("AudienceCard", () => {
  it("shows the shares, the average view and the top traits with intervals", () => {
    withTooltips(<AudienceCard card={SAMPLE_CARDS[0] as never} />);
    const card = screen
      .getByRole("heading", { name: "Subscribers" })
      .closest("div.relative") as HTMLElement;
    expect(within(card).getByText("31%")).toBeTruthy();
    expect(within(card).getByText("38%")).toBeTruthy();
    expect(within(card).getByText("52.1%")).toBeTruthy();
    expect(within(card).getByText("A 20 s payoff beat at 75%")).toBeTruthy();
    expect(within(card).getByText("+3.4 pp (1.2 to 5.6)")).toBeTruthy();
    expect(within(card).getByText("Measured")).toBeTruthy();
  });

  it("says plainly when there are no clear traits or YouTube reports no number", () => {
    withTooltips(
      <>
        <AudienceCard card={SAMPLE_CARDS[1] as never} />
        <AudienceCard card={SAMPLE_CARDS[2] as never} />
      </>,
    );
    expect(screen.getByText(/No clear traits yet/)).toBeTruthy();
    expect(screen.getAllByText("Not reported")).toHaveLength(2);
  });
});

describe("KindBadge", () => {
  it("explains an estimated audience on keyboard focus", async () => {
    const user = userEvent.setup();
    withTooltips(<KindBadge kind="estimated" />);
    await user.tab();
    expect(screen.getByRole("button", { name: /Estimated/ })).toBe(document.activeElement);
    expect((await screen.findByRole("tooltip")).textContent).toMatch(
      /YouTube has no curve for this group/,
    );
  });
});

describe("ResultNotice", () => {
  it("says the numbers are not a result yet, and why", () => {
    render(<ResultNotice reasons={["trained on 3 videos; at least 30 are needed"]} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toContain("Not a result yet");
    expect(note.textContent).toContain("Trained on 3 videos; at least 30 are needed.");
  });
});

describe("charts", () => {
  it("describes the retention chart for screen readers, with each audience's end point", () => {
    render(
      <RetentionChart
        id="t"
        title="Who is still watching"
        series={SAMPLE_SERIES}
        durationS={212}
      />,
    );
    // A narrow plot for phones and a wide one above; CSS shows one (jsdom has no CSS).
    const plots = screen.getAllByRole("img");
    expect(plots.map((plot) => plot.getAttribute("viewBox"))).toEqual([
      "0 0 400 300",
      "0 0 720 340",
    ]);
    for (const plot of plots) {
      expect(plot.getAttribute("aria-label")).toMatch(
        /^Who is still watching\. Subscribers: \d+% still watching at the end; Newcomers: \d+%/,
      );
    }
    expect(plots[0]?.getAttribute("class")).toContain("sm:hidden");
    expect(screen.getAllByText("3:32")).toHaveLength(2);
  });

  it("labels every beat, widest for the longest", () => {
    render(<BeatStrip beats={SAMPLE_BEATS} durationS={212} />);
    const beats = within(screen.getByRole("list", { name: "Beats" })).getAllByRole("listitem");
    expect(beats.map((beat) => beat.textContent?.replace(/\d+:\d\d$/, ""))).toEqual([
      "Hook",
      "Branded intro",
      "Explanation",
      "Sponsor",
      "Demo",
      "Payoff",
      "Call to action",
    ]);
    expect(beats[1]?.className).toContain("bg-beat-opening");
    expect(beats[3]?.className).toContain("bg-beat-promotion");
    expect(beats[2]?.className).toContain("bg-surface");
  });
});
