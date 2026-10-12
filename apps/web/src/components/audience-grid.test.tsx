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
  it("opens a card's sheet with every effect, clear or not", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "See every effect (4)" }));
    const sheet = screen.getByRole("dialog", { name: "Subscribers: every effect" });
    expect(within(sheet).getByText(/Not a result yet: trained on 3 videos/)).toBeTruthy();
    for (const label of [
      "A 20 s payoff beat at 75%",
      "A 30 s sponsor read at 30%",
      "A 45 s tangent at 50%",
      "A 15 s call to action at 50%",
    ]) {
      expect(within(sheet).getByText(label)).toBeTruthy();
    }
    expect(within(sheet).getAllByText("Can't tell yet")).toHaveLength(1);
    expect(within(sheet).getByText("Not learned: it never varies in your videos")).toBeTruthy();
  });

  it("does not open a sheet for a card without effects", () => {
    show([{ ...SAMPLE_CARDS[1], effects: [], model: null, traits: [] } as never]);
    expect(screen.queryByRole("button", { name: /See every effect/ })).toBeNull();
  });

  it("never says cohort", () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/cohort/i);
  });
});
