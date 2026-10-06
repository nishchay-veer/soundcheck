import { describe, expect, it } from "vitest";
import { buttonVariants } from "./button";

describe("buttonVariants", () => {
  it("defaults to the pink primary button with a black border", () => {
    const classes = buttonVariants();
    expect(classes).toContain("bg-accent");
    expect(classes).toContain("border-2");
    expect(classes).toContain("border-ink");
  });

  it("drops the lift and shadow for ghost buttons", () => {
    const classes = buttonVariants({ variant: "ghost" });
    expect(classes).toContain("underline");
    expect(classes).toContain("hover:shadow-none");
  });
});
