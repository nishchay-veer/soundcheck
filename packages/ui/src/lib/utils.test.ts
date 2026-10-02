import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("drops falsy values", () => {
    expect(cn("border-2", false, undefined, null, "")).toBe("border-2");
  });

  it("lets the later Tailwind class win a conflict", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
  });
});
