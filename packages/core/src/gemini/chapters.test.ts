import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeGenAI } from "../fake-genai";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { CHAPTERS_PROMPT_VERSION } from "../prompts";
import { checkChapters, titleChapters, type ChapterBeat } from "./chapters";

const CHANNEL = "UC-BHlgFbFh3V76yth-XCmlw";
const ID = "8f14e45fceea167a5a36dedd4bea2543";
const quiet = createLogger({ level: "silent" });
const beats: ChapterBeat[] = [
  { startS: 0, endS: 20, type: "hook", summary: "Will the old bridge hold a car?" },
  { startS: 20, endS: 80, type: "explanation", summary: "How the beams carry weight." },
  { startS: 80, endS: 130, type: "sponsor", summary: "A word from the sponsor." },
  { startS: 130, endS: 200, type: "demonstration", summary: "Driving the car across." },
  { startS: 200, endS: 240, type: "outro", summary: "What to build next." },
];
const answer = (chapters: unknown) => ({ text: JSON.stringify({ chapters }) });
const good = [
  { first_beat: 0, title: "Will the bridge hold?" },
  { first_beat: 1, title: "How the beams work" },
  { first_beat: 3, title: "The drive across" },
];

describe("checkChapters", () => {
  it("accepts chapters from beat 0, going forward, titled in at most five words", () => {
    expect(checkChapters({ chapters: good }, 5)).toEqual([]);
  });

  it("names each problem for the second ask", () => {
    expect(checkChapters({ chapters: [{ first_beat: 1, title: "Late" }] }, 5)).toEqual([
      "Chapter 1 must start at beat 0.",
    ]);
    expect(
      checkChapters(
        {
          chapters: [
            { first_beat: 0, title: "A title that is far too long" },
            { first_beat: 0, title: "Again" },
            { first_beat: 9, title: "Nowhere" },
          ],
        },
        5,
      ),
    ).toEqual([
      'Chapter 1\'s title must be 1 to 5 words: "A title that is far too long".',
      "Chapter 2 must start after chapter 1.",
      "Chapter 3 starts at beat 9, which does not exist.",
    ]);
    expect(checkChapters("nonsense", 5)).toHaveLength(1);
  });
});

describe("titleChapters", () => {
  let gemini: FakeGenAI;
  let storage: FakeStorage;
  const title = (list = beats) =>
    titleChapters(
      { channelId: CHANNEL, soundcheckId: ID, beats: list, videoSummary: "Testing a bridge." },
      { model: "flash", log: quiet },
    );

  beforeEach(() => {
    vi.stubEnv("GCS_UPLOADS_BUCKET", "test-uploads");
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

  it("asks once with the beats and keeps the chapters, archived with the upload", async () => {
    gemini.answer(answer(good));
    expect(await title()).toEqual([
      { firstBeat: 0, title: "Will the bridge hold?" },
      { firstBeat: 1, title: "How the beams work" },
      { firstBeat: 3, title: "The drive across" },
    ]);
    expect(gemini.requests).toHaveLength(1);
    const text = JSON.stringify(gemini.requests[0]?.contents);
    expect(text).toContain('\\"start\\":\\"2:10\\"');
    expect(text).toContain("Driving the car across.");
    expect(gemini.requests[0]?.model).toBe("flash");
    const archived = storage.read(
      `gs://test-uploads/${CHANNEL}/soundcheck-chapters/${ID}-a1/${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`,
    );
    expect(archived).toContain("Will the bridge hold?");
    expect(CHAPTERS_PROMPT_VERSION).toBe("chapters-v1");
  });

  it("asks again once with the problems, then gives up without chapters", async () => {
    gemini.answer(answer([{ first_beat: 2, title: "Late" }]), answer(good));
    expect(await title()).toHaveLength(3);
    expect(JSON.stringify(gemini.requests[1]?.contents)).toContain(
      "Chapter 1 must start at beat 0.",
    );

    gemini.answer(
      answer([{ first_beat: 2, title: "Late" }]),
      answer([{ first_beat: 2, title: "Late" }]),
    );
    expect(await title()).toBeNull();
  });

  it("has no chapters when Gemini cannot answer, or the cut is too short for three", async () => {
    gemini.answer(new Error("400 INVALID_ARGUMENT"));
    expect(await title()).toBeNull();
    const before = gemini.requests.length;
    expect(await title(beats.slice(0, 2))).toBeNull();
    expect(gemini.requests).toHaveLength(before);
  });
});
