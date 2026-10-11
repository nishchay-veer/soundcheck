// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Card } from "./card";
import { Progress } from "./progress";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "./sheet";
import { Skeleton } from "./skeleton";

afterEach(cleanup);

describe("restyled primitives", () => {
  it("draws cards and badges with black borders, lifting only clickable cards", () => {
    render(
      <>
        <Card data-testid="static">Static</Card>
        <Card data-testid="clickable" interactive>
          Clickable
        </Card>
        <Badge>New</Badge>
      </>,
    );
    expect(screen.getByTestId("static").className).toContain("border-2");
    expect(screen.getByTestId("static").className).not.toContain("hover:shadow-hard");
    expect(screen.getByTestId("clickable").className).toContain("hover:shadow-hard");
    expect(screen.getByText("New").className).toContain("rounded-full");
  });

  it("reports progress to assistive technology, and hides skeletons from it", () => {
    render(
      <>
        <Progress value={35} aria-label="Watching your videos" />
        <Skeleton data-testid="skeleton" />
      </>,
    );
    const bar = screen.getByRole("progressbar", { name: "Watching your videos" });
    expect(bar.getAttribute("aria-valuenow")).toBe("35");
    expect(screen.getByTestId("skeleton").getAttribute("aria-hidden")).toBe("true");
  });

  it("opens a sheet as a labelled dialog and closes it with its button or Escape", async () => {
    const user = userEvent.setup();
    render(
      <Sheet>
        <SheetTrigger>Open</SheetTrigger>
        <SheetContent>
          <SheetTitle>Every effect</SheetTitle>
          <SheetDescription>With intervals.</SheetDescription>
        </SheetContent>
      </Sheet>,
    );
    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByRole("dialog", { name: "Every effect" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
