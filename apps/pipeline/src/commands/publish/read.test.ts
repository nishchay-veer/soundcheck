import { describe, expect, it } from "vitest";
import { transcriptExcerpt } from "./read";

describe("transcriptExcerpt", () => {
  it("keeps a short transcript, tidied, and is empty without one", () => {
    expect(transcriptExcerpt("  Hello   there,\nfriends. ")).toBe("Hello there, friends.");
    expect(transcriptExcerpt("")).toBe("");
    expect(transcriptExcerpt(undefined)).toBe("");
  });

  it("cuts a long one at a word, within 140 characters, with an ellipsis", () => {
    const long = "word ".repeat(60);
    const excerpt = transcriptExcerpt(long);
    expect(excerpt.length).toBeLessThanOrEqual(140);
    expect(excerpt.endsWith("word…")).toBe(true);
    // A transcript with no spaces to cut at is cut where it reaches the limit.
    expect(transcriptExcerpt("x".repeat(300))).toBe(`${"x".repeat(139)}…`);
  });
});
