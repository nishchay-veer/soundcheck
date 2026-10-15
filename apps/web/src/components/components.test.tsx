// @vitest-environment jsdom
import { TooltipProvider } from "@soundcheck/ui/components/tooltip";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_CARDS } from "@/app/styleguide/samples";
import { AudienceCard } from "./audience-card";
import { KindBadge } from "./kind-badge";
import { ResultNotice } from "./result-notice";

afterEach(cleanup);

const withTooltips = (node: React.ReactNode) => render(<TooltipProvider>{node}</TooltipProvider>);

describe("AudienceCard", () => {
  it("shows the shares, the average view and what makes a difference, in plain words", () => {
    withTooltips(<AudienceCard card={SAMPLE_CARDS[0] as never} />);
    const card = screen
      .getByRole("heading", { name: "Subscribers" })
      .closest("div.relative") as HTMLElement;
    expect(within(card).getByText("31%")).toBeTruthy();
    expect(within(card).getByText("38%")).toBeTruthy();
    expect(within(card).getByText("52.1%")).toBeTruthy();
    const traits = within(card)
      .getAllByRole("listitem")
      .map((item) => item.textContent);
    expect(traits).toEqual([
      "Payoff moments: about 3 more in 100 stay",
      "Sponsor reads: about 2 fewer in 100 stay",
    ]);
    expect(within(card).queryByText(/pp|interval/)).toBeNull();
    expect(within(card).getByText("Measured")).toBeTruthy();
  });

  it("says plainly when there are no clear traits or YouTube reports no number", () => {
    withTooltips(
      <>
        <AudienceCard card={SAMPLE_CARDS[1] as never} />
        <AudienceCard card={SAMPLE_CARDS[2] as never} />
      </>,
    );
    expect(screen.getByText(/^Nothing clear yet\. With more videos/)).toBeTruthy();
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
