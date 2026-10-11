import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeGenAI } from "../fake-genai";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { checkCaption, narrate, numbersIn, type NarrationItem } from "./narration";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const quiet = createLogger({ level: "silent" });

const drop: NarrationItem = {
  id: "drop-1",
  kind: "drop",
  maxWords: 40,
  facts: { audience: "Newcomers", start: "1:12", end: "1:20", lossPoints: "6.4" },
  fallback: "Newcomers drop 6.4 points between 1:12 and 1:20.",
};
const card: NarrationItem = {
  id: "card-unsubscribed",
  kind: "audience",
  maxWords: 30,
  facts: { audience: "Newcomers", viewSharePercent: "62", averageViewPercent: "41.3" },
  fallback: "Newcomers bring 62% of your views and watch 41.3% of a video on average.",
};

const reply = (captions: Record<string, string>) => ({
  text: JSON.stringify({ items: Object.entries(captions).map(([id, text]) => ({ id, text })) }),
});

describe("numbersIn", () => {
  it("finds decimals, clock times and percentages, and ignores thousands separators", () => {
    expect(numbersIn("Newcomers drop 6.4 points between 1:12 and 1:20, 55% of it.")).toEqual([
      "6.4",
      "1:12",
      "1:20",
      "55",
    ]);
    expect(numbersIn("1,204 views, down -2.1 points")).toEqual(["1204", "2.1"]);
  });
});

describe("checkCaption", () => {
  it("rejects a number that is not in the facts", () => {
    expect(checkCaption("Newcomers drop 6.4 points between 1:12 and 1:20.", drop)).toEqual([]);
    expect(checkCaption("Newcomers drop 7 points between 1:12 and 1:20.", drop)).toEqual([
      "these numbers are not in the facts: 7",
    ]);
    // Rounding is inventing too.
    expect(checkCaption("Newcomers drop about 6 points at 1:12.", drop)).toHaveLength(1);
  });

  it("rejects an empty or long caption, and the word cohort", () => {
    expect(checkCaption("  ", drop)).toEqual(["the caption is empty"]);
    expect(checkCaption("word ".repeat(41), drop)).toEqual(["it has 41 words, more than 40"]);
    expect(checkCaption("This cohort drops at 1:12.", drop)[0]).toMatch(/cohort/);
  });
});

describe("narrate", () => {
  let gemini: FakeGenAI;
  let storage: FakeStorage;

  beforeEach(() => {
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    gemini = new FakeGenAI();
    storage = new FakeStorage();
    setClientOverride("genai", gemini.asGenAI());
    setClientOverride("storage", storage.asStorage());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const run = (items = [drop, card]) => narrate(CHANNEL, items, { model: "flash", log: quiet });
  /** The message text of the n-th request. */
  const message = (n: number) =>
    (gemini.requests[n]?.contents as { parts: { text: string }[] }[])[0]?.parts[0]?.text ?? "";
  const cached = () =>
    [...(storage.buckets["test-raw"] ?? [])].filter((name) => name.includes("/narration/"));
  const archived = () =>
    [...(storage.buckets["test-raw"] ?? [])].filter((name) => name.includes("/gemini-narration/"));

  it("captions every item in one call from facts alone, archives the answer and caches it", async () => {
    gemini.answer(
      reply({
        "drop-1": "Between 1:12 and 1:20 your newcomers drop 6.4 points.",
        "card-unsubscribed": "Newcomers bring 62% of your views.",
      }),
    );
    const narrations = await run();
    expect(narrations.get("drop-1")).toEqual({
      text: "Between 1:12 and 1:20 your newcomers drop 6.4 points.",
      source: "gemini",
    });
    expect(narrations.get("card-unsubscribed")?.source).toBe("gemini");
    expect(gemini.requests).toHaveLength(1);
    const request = gemini.requests[0];
    expect(request?.model).toBe("flash");
    expect(message(0)).toContain('"lossPoints":"6.4"');
    expect(message(0)).not.toContain("fallback");
    expect(archived()).toHaveLength(1);
    expect(cached()).toHaveLength(1);

    // The same facts again cost nothing.
    expect(await run()).toEqual(narrations);
    expect(gemini.requests).toHaveLength(1);
  });

  it("asks once more for a caption that invents a number, with the reason", async () => {
    gemini.answer(
      reply({
        "drop-1": "Newcomers drop 7 points at 1:12.",
        "card-unsubscribed": "Newcomers bring 62% of your views.",
      }),
      reply({ "drop-1": "Newcomers drop 6.4 points from 1:12." }),
    );
    const narrations = await run();
    expect(narrations.get("drop-1")).toEqual({
      text: "Newcomers drop 6.4 points from 1:12.",
      source: "gemini",
    });
    expect(message(1)).toContain("drop-1: these numbers are not in the facts: 7");
    expect(message(1)).not.toContain("card-unsubscribed");
  });

  it("falls back to the template after a second failure, or a missing caption", async () => {
    gemini.answer(
      reply({ "drop-1": "Newcomers drop 7 points." }),
      reply({ "drop-1": "Newcomers drop 8 points." }),
    );
    const narrations = await run();
    expect(narrations.get("drop-1")).toEqual({ text: drop.fallback, source: "template" });
    expect(narrations.get("card-unsubscribed")).toEqual({
      text: card.fallback,
      source: "template",
    });
    expect(gemini.requests).toHaveLength(2);
    expect(cached()).toHaveLength(1);
  });

  it("uses the templates without caching when Gemini cannot be reached", async () => {
    gemini.answer(new Error("400 INVALID_ARGUMENT"));
    const narrations = await run();
    expect([...narrations.values()].every((n) => n.source === "template")).toBe(true);
    expect(cached()).toHaveLength(0);
  });

  it("treats an answer that is not JSON as no captions", async () => {
    gemini.answer(
      { text: "Sure! Here you go." },
      reply({ "drop-1": drop.fallback, "card-unsubscribed": card.fallback }),
    );
    const narrations = await run();
    expect(narrations.get("drop-1")?.source).toBe("gemini");
    expect(gemini.requests).toHaveLength(2);
  });

  it("refuses a template that would fail its own checks, and duplicate IDs", async () => {
    await expect(run([{ ...drop, fallback: "Newcomers drop 9 points." }])).rejects.toThrow(
      /template for drop-1 fails/,
    );
    await expect(run([drop, drop])).rejects.toThrow(/unique/);
    expect(gemini.requests).toHaveLength(0);
  });
});
