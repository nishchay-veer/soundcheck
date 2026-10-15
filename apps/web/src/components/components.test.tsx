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
  const twoVideos = "trained on 2 videos; at least 8 are needed";

  it("says no number is a result yet when no model is usable, and why", () => {
    render(
      <ResultNotice
        standing={{
          notUsable: [
            { label: "Subscribers", reasons: ["trained on 3 videos; at least 8 are needed"] },
            { label: "Newcomers", reasons: ["trained on 3 videos; at least 8 are needed"] },
          ],
          usable: [],
        }}
      />,
    );
    expect(screen.getByRole("note").textContent).toBe(
      "Not a result yet" +
        "Trained on 3 videos; at least 8 are needed. These numbers show that Soundcheck works on your channel; they don't describe your audiences yet.",
    );
  });

  it("names the audience it is about when the others' numbers are real results", () => {
    render(
      <ResultNotice
        standing={{
          notUsable: [{ label: "Subscribers", reasons: [twoVideos] }],
          usable: ["Newcomers"],
        }}
      />,
    );
    const note = screen.getByRole("note");
    expect(within(note).getByText("Not a result yet for subscribers")).toBeTruthy();
    expect(note.textContent).toContain(
      "Subscribers: trained on 2 videos; at least 8 are needed. Until then, their numbers don't describe how they watch. The numbers for newcomers are real results.",
    );
    expect(note.textContent).not.toContain("don't describe your audiences");
  });

  it("shows nothing when every model is usable", () => {
    const { container } = render(
      <ResultNotice standing={{ notUsable: [], usable: ["Subscribers", "Newcomers"] }} />,
    );
    expect(container.textContent).toBe("");
  });
});
