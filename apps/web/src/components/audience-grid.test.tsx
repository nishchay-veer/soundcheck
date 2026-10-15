// @vitest-environment jsdom
import { TooltipProvider } from "@soundcheck/ui/components/tooltip";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { SAMPLE_CARDS } from "@/app/styleguide/samples";
import { AudienceGrid } from "./audience-grid";

afterEach(cleanup);

const show = (cards = SAMPLE_CARDS) =>
  render(
    <TooltipProvider>
      <AudienceGrid cards={cards} />
    </TooltipProvider>,
  );

describe("AudienceGrid", () => {
  it("opens a card's sheet with its effects in plain words, grouped by what they say", async () => {
    show();
    await userEvent.click(
      screen.getAllByRole("button", { name: "See what keeps them watching" })[0] as HTMLElement,
    );
    const sheet = screen.getByRole("dialog", { name: "Subscribers: what keeps them watching" });
    expect(within(sheet).getByText(/Not a result yet: trained on 3 videos/)).toBeTruthy();
    const group = (title: RegExp) =>
      within(sheet).getByRole("heading", { name: title }).closest("section") as HTMLElement;

    const keeps = group(/^Keeps them watching$/);
    expect(within(keeps).getByText("Payoff moments")).toBeTruthy();
    expect(within(keeps).getByText("Keeps viewers")).toBeTruthy();
    expect(within(keeps).getByText("Adding a 20-second payoff 75% of the way in")).toBeTruthy();
    expect(
      within(keeps).getByText(
        "About 3 more of every 100 viewers stay to the end (between 1 and 6).",
      ),
    ).toBeTruthy();
    const leaves = group(/^Makes them leave$/);
    expect(within(leaves).getByText("Sponsor reads")).toBeTruthy();
    expect(within(leaves).getByText("Loses viewers")).toBeTruthy();
    expect(within(group(/^No clear effect yet \(1\)$/)).getByText("Tangents")).toBeTruthy();
    expect(
      within(group(/^Not in your videos yet \(1\)$/)).getByText("Calls to action"),
    ).toBeTruthy();
    // No statistics vocabulary.
    expect(sheet.textContent).not.toMatch(/\bpp\b|interval|percentage points/);
    expect(within(sheet).queryByText(/^Nothing clear yet/)).toBeNull();
  });

  it("says plainly when nothing is clear yet", async () => {
    show([SAMPLE_CARDS[1] as never]);
    await userEvent.click(screen.getByRole("button", { name: "See what keeps them watching" }));
    const sheet = screen.getByRole("dialog", { name: "Newcomers: what keeps them watching" });
    expect(within(sheet).getByText("Nothing clear yet.")).toBeTruthy();
    expect(within(sheet).queryByRole("heading", { name: "Keeps them watching" })).toBeNull();
  });

  it("does not open a sheet for a card without effects", () => {
    show([{ ...SAMPLE_CARDS[1], effects: [], model: null, traits: [] } as never]);
    expect(screen.queryByRole("button", { name: /See what keeps them watching/ })).toBeNull();
  });

  it("never says cohort", () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/cohort/i);
  });
});
