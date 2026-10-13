import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { beatTypeSchema, featureBeatInputSchema, musicSchema, visualSchema } from "../schemas";
import { toFeatureBeat, toFeatureBeatInput } from "./inputs";
import { buildBins, type FeatureBeat } from "./timeline";

const ratings = fc.integer({ min: 1, max: 5 });
const beatFields = fc.record({
  beat_type: fc.constantFrom(...beatTypeSchema.options),
  talking_head_share: ratings,
  visual: fc.constantFrom(...visualSchema.options),
  cuts_per_min: fc.integer({ min: 0, max: 400 }),
  on_screen_text: fc.boolean(),
  music: fc.constantFrom(...musicSchema.options),
  energy: ratings,
  assumed_knowledge: ratings,
  info_density: ratings,
  // A blank question opens nothing, as a blank transcript says nothing.
  opens_loop: fc.option(fc.constantFrom("Why?", " ", "What next?")),
  closes_loop: fc.boolean(),
  transcript: fc.constantFrom("", "  ", "a few words here"),
  words_per_minute: fc.double({ min: 0, max: 600, noNaN: true }),
});

/** A cut of up to 20 contiguous beats. */
const cuts = fc
  .record({
    duration: fc.double({ min: 60, max: 3_600, noNaN: true }),
    edges: fc.uniqueArray(fc.double({ min: 0.01, max: 0.99, noNaN: true }), { maxLength: 19 }),
    fields: fc.array(beatFields, { minLength: 20, maxLength: 20 }),
  })
  .map(({ duration, edges, fields }) => {
    const points = [0, ...[...edges].sort((a, b) => a - b), 1].map((edge) => edge * duration);
    // Two cut points can round to the same second; extraction never gives an empty beat.
    const beats: FeatureBeat[] = points
      .slice(0, -1)
      .map((start, i) => ({
        ...(fields[i] as (typeof fields)[number]),
        start_s: start,
        end_s: points[i + 1] as number,
      }))
      .filter((beat) => beat.end_s > beat.start_s);
    return { duration, beats };
  });

/** Exact equality, value by value: far faster than toEqual on long typed arrays. */
const sameValues = (a: Float64Array, b: Float64Array) =>
  a.length === b.length && a.every((value, i) => Object.is(value, b[i]));

const channel = { medianTargetLevel: 3, mixMean: { search: 0.3, suggested: 0.4, browse: 0.2 } };
const mix = { search: 0.5, suggested: 0.3, browse: 0.1 };

describe("stored soundcheck beats", () => {
  it("build exactly the bins of the beats they came from, for every audience", () => {
    fc.assert(
      fc.property(cuts, ({ duration, beats }) => {
        const stored = beats.map(toFeatureBeatInput);
        for (const beat of stored) expect(featureBeatInputSchema.parse(beat)).toEqual(beat);
        const video = { format: "tutorial" as const, target_level: 2, payoff_time_s: duration / 2 };
        const back = stored.map(toFeatureBeat);
        for (const audienceMix of [null, mix]) {
          const original = buildBins({ ...video, beats }, duration, channel, audienceMix);
          const roundTrip = buildBins({ ...video, beats: back }, duration, channel, audienceMix);
          expect(sameValues(roundTrip.values, original.values)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  }, 30_000);

  it("keep no transcript or question text", () => {
    const stored = toFeatureBeatInput({
      start_s: 0,
      end_s: 30,
      beat_type: "hook",
      talking_head_share: 5,
      visual: "none",
      cuts_per_min: 4,
      on_screen_text: false,
      music: "background",
      energy: 4,
      assumed_knowledge: 2,
      info_density: 3,
      opens_loop: "Will the bridge hold?",
      closes_loop: false,
      transcript: "Today we test whether this bridge can hold a car.",
      words_per_minute: 150,
    });
    expect(JSON.stringify(stored)).not.toMatch(/bridge/);
    expect(stored).toMatchObject({ opensLoop: true, speaks: true, wordsPerMinute: 150 });
  });
});
