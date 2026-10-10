import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { beatTypeSchema, musicSchema, videoFormatSchema, visualSchema } from "../schemas";
import { FEATURE_NAMES, FEATURE_SPEC, POSITION_KNOTS, featureIndex } from "./spec";
import { bsplineBasis } from "./spline";
import {
  buildBins,
  channelContext,
  frameColumn,
  frameRow,
  tileBeats,
  type ChannelContext,
  type FeatureBeat,
  type FeatureVideo,
  type TrafficMix,
} from "./timeline";

const beat = (overrides: Partial<FeatureBeat> & Pick<FeatureBeat, "start_s" | "end_s">) => ({
  beat_type: "explanation" as const,
  talking_head_share: 3,
  visual: "none" as const,
  cuts_per_min: 0,
  on_screen_text: false,
  music: "none" as const,
  energy: 3,
  assumed_knowledge: 3,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  transcript: "Some words.",
  words_per_minute: 100,
  ...overrides,
});

/**
 * 200 s, so every bin is 2 s: a hook to 40.5 s that opens a loop, a
 * demonstration to 150 s, and a silent payoff beat that closes the loop.
 * The title's promise is delivered at 160 s.
 */
const golden: FeatureVideo = {
  format: "tutorial",
  target_level: 2,
  payoff_time_s: 160,
  beats: [
    beat({
      start_s: 0,
      end_s: 40.5,
      beat_type: "hook",
      talking_head_share: 5,
      energy: 4,
      assumed_knowledge: 1,
      info_density: 2,
      opens_loop: "Will it work?",
      words_per_minute: 120,
    }),
    beat({
      start_s: 40.5,
      end_s: 150,
      beat_type: "demonstration",
      talking_head_share: 2,
      visual: "screen_recording",
      cuts_per_min: 6,
      on_screen_text: true,
      music: "background",
      energy: 2,
      assumed_knowledge: 3,
      info_density: 4,
      words_per_minute: 150,
    }),
    beat({
      start_s: 150,
      end_s: 200,
      beat_type: "payoff",
      talking_head_share: 5,
      cuts_per_min: 1,
      energy: 5,
      assumed_knowledge: 2,
      info_density: 3,
      closes_loop: true,
      transcript: "",
      words_per_minute: 0,
    }),
  ],
};
const channel: ChannelContext = {
  medianTargetLevel: 2,
  mixMean: { search: 0.2, suggested: 0.3, browse: 0.4 },
};
const newcomerMix: TrafficMix = { search: 0.5, suggested: 0.1, browse: 0.3 };

/** Checks the named values of one bin (numbered from 1, like the curve) and that every other column is 0. */
function expectBin(
  frame: ReturnType<typeof buildBins>,
  bin: number,
  expected: Record<string, number>,
) {
  const row = frameRow(frame, bin - 1);
  FEATURE_NAMES.forEach((name, index) => {
    expect(row[index], `${name} in bin ${bin}`).toBeCloseTo(expected[name] ?? 0, 12);
  });
}

const position = (bin: number) =>
  Object.fromEntries(
    bsplineBasis((bin - 0.5) / 100, POSITION_KNOTS, 3)
      .slice(1)
      .map((value, index) => [`pos_b${index + 1}`, value]),
  );

describe("buildBins: golden video", () => {
  const frame = buildBins(golden, 200, channel, newcomerMix);
  const video = { format_tutorial: 1, target_level: 2, log_bin_seconds: Math.log(2) };
  const mix = { mix_search: 0.3, mix_suggested: -0.2, mix_browse: -0.1 };

  it("has 100 rows of every spec column", () => {
    expect(frame.rows).toBe(100);
    expect(frame.columns).toEqual(FEATURE_NAMES);
    expect(frame.values).toHaveLength(100 * FEATURE_SPEC.length);
  });

  it("bin 1: the hook alone, an open loop, and the newcomer mix with its interactions", () => {
    expectBin(frame, 1, {
      ...video,
      ...mix,
      ...position(1),
      beat_hook: 1,
      visual_none: 1,
      talking_head_share: 5,
      static_talking_head_share: 1,
      silence: 0,
      energy: 4,
      assumed_knowledge: 1,
      info_density: 2,
      speech_wpm: 120,
      log1p_secs_in_current_beat: Math.log1p(1),
      log1p_static_run_s: Math.log1p(1),
      has_open_loop: 1,
      before_payoff: 1,
      knowledge_gap: -1,
      is_first_bin: 1,
      ix_knowledge_gap_search: -0.3,
      ix_knowledge_gap_suggested: 0.2,
      ix_knowledge_gap_browse: 0.1,
      ix_log1p_static_run_s_search: Math.log1p(1) * 0.3,
      ix_log1p_static_run_s_suggested: Math.log1p(1) * -0.2,
      ix_log1p_static_run_s_browse: Math.log1p(1) * -0.1,
      ix_info_density_search: 0.6,
      ix_info_density_suggested: -0.4,
      ix_info_density_browse: -0.2,
      ix_before_payoff_search: 0.3,
      ix_before_payoff_suggested: -0.2,
      ix_before_payoff_browse: -0.1,
    });
  });

  it("bin 21 (40-42 s): a quarter hook and three quarters demonstration, weighted by overlap", () => {
    expectBin(frame, 21, {
      ...video,
      ...mix,
      ...position(21),
      beat_hook: 0.25,
      beat_demonstration: 0.75,
      visual_none: 0.25,
      visual_screen_recording: 0.75,
      talking_head_share: 0.25 * 5 + 0.75 * 2,
      static_talking_head_share: 0.25,
      log1p_cuts_per_min: Math.log1p(0.75 * 6),
      on_screen_text: 0.75,
      music_bg: 0.75,
      energy: 2.5,
      assumed_knowledge: 2.5,
      info_density: 3.5,
      speech_wpm: 0.25 * 120 + 0.75 * 150,
      log1p_secs_in_current_beat: Math.log1p(0.5),
      log1p_static_run_s: 0,
      energy_delta: 2.5 - 4,
      has_open_loop: 1,
      before_payoff: 1,
      knowledge_gap: 0.5,
      ix_knowledge_gap_search: 0.15,
      ix_knowledge_gap_suggested: -0.1,
      ix_knowledge_gap_browse: -0.05,
      ix_info_density_search: 1.05,
      ix_info_density_suggested: -0.7,
      ix_info_density_browse: -0.35,
      ix_before_payoff_search: 0.3,
      ix_before_payoff_suggested: -0.2,
      ix_before_payoff_browse: -0.1,
    });
  });

  it("bin 76 (150-152 s): the payoff beat closes the loop, is silent, and starts a static run", () => {
    const row = frameRow(frame, 75);
    const value = (name: string) => row[featureIndex(name)];
    expect(value("beat_payoff")).toBe(1);
    expect(value("silence")).toBe(1);
    expect(value("has_open_loop")).toBe(0);
    expect(value("before_payoff")).toBe(1);
    expect(value("static_talking_head_share")).toBe(1);
    expect(value("log1p_static_run_s")).toBeCloseTo(Math.log1p(1), 12);
    expect(value("log1p_cuts_per_min")).toBeCloseTo(Math.log1p(1), 12);
    expect(value("energy_delta")).toBe(3);
    expect(value("knowledge_gap")).toBe(0);
  });

  it("switches before_payoff off at the payoff time and keeps counting the static run", () => {
    const before = frameColumn(frame, "before_payoff");
    expect(before[79]).toBe(1); // 158-160 s, midpoint 159
    expect(before[80]).toBe(0); // 160-162 s, midpoint 161
    expect(frameColumn(frame, "log1p_static_run_s")[99]).toBeCloseTo(Math.log1p(49), 12);
    expect(frameColumn(frame, "log1p_secs_in_current_beat")[99]).toBeCloseTo(Math.log1p(49), 12);
  });

  it("leaves the mix and interaction columns at 0 without a newcomer mix", () => {
    const subscribers = buildBins(golden, 200, channel, null);
    for (const feature of FEATURE_SPEC) {
      const column = frameColumn(subscribers, feature.name);
      if (feature.kind === "mix" || feature.kind === "interaction") {
        expect(
          column.every((value) => value === 0),
          feature.name,
        ).toBe(true);
      } else {
        expect(column, feature.name).toEqual(frameColumn(frame, feature.name));
      }
    }
  });

  it("is deterministic: the same input gives a byte-identical frame", () => {
    const again = buildBins(structuredClone(golden), 200, { ...channel }, { ...newcomerMix });
    expect(Buffer.from(again.values.buffer).equals(Buffer.from(frame.values.buffer))).toBe(true);
  });
});

describe("tileBeats", () => {
  it("splits gaps and overlaps at their midpoint and stretches the ends to 0 and D", () => {
    const segments = tileBeats(
      [
        beat({ start_s: 12, end_s: 21 }),
        beat({ start_s: 0.5, end_s: 10 }),
        beat({ start_s: 20, end_s: 28 }),
        beat({ start_s: 31, end_s: 40 }),
      ],
      30,
    );
    expect(segments.map(({ start, end }) => [start, end])).toEqual([
      [0, 11],
      [11, 20.5],
      [20.5, 30],
    ]);
  });

  it("needs a beat that starts inside the video", () => {
    expect(() => tileBeats([beat({ start_s: 30, end_s: 40 })], 30)).toThrow(RangeError);
  });
});

describe("buildBins: any valid video", () => {
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
    opens_loop: fc.option(fc.constantFrom("Why?", " ", "What next?")),
    closes_loop: fc.boolean(),
    transcript: fc.constantFrom("", "a few words here"),
    words_per_minute: fc.double({ min: 0, max: 600, noNaN: true }),
  });
  /** Beats between sorted cut points, each shrunk a little so some gaps appear. */
  const videos = fc
    .record({
      duration: fc.double({ min: 1, max: 10_800, noNaN: true }),
      cuts: fc.uniqueArray(fc.double({ min: 0.01, max: 0.99, noNaN: true }), { maxLength: 30 }),
      fields: fc.array(beatFields, { minLength: 31, maxLength: 31 }),
      shrink: fc.double({ min: 0, max: 0.02, noNaN: true }),
      format: fc.constantFrom(...videoFormatSchema.options),
      targetLevel: ratings,
      payoff: fc.option(fc.double({ min: 0, max: 1, noNaN: true })),
      mix: fc.option(
        fc.record({
          search: fc.double({ min: 0, max: 1, noNaN: true }),
          suggested: fc.double({ min: 0, max: 1, noNaN: true }),
          browse: fc.double({ min: 0, max: 1, noNaN: true }),
        }),
      ),
    })
    .map(({ duration, cuts, fields, shrink, format, targetLevel, payoff, mix }) => {
      const edges = [0, ...[...cuts].sort((a, b) => a - b), 1].map((edge) => edge * duration);
      const beats = edges.slice(0, -1).map((start, index) => {
        const end = edges[index + 1] as number;
        const margin = (end - start) * shrink;
        const field = fields[index] as (typeof fields)[number];
        return { ...field, start_s: start + margin, end_s: end - margin };
      });
      const video: FeatureVideo = {
        format,
        target_level: targetLevel,
        payoff_time_s: payoff === null ? null : payoff * duration,
        beats,
      };
      return { video, duration, mix };
    });

  it("gives shares that sum to 1 in every bin and keeps every column within its clip", () => {
    fc.assert(
      fc.property(videos, ({ video, duration, mix }) => {
        const frame = buildBins(video, duration, channel, mix);
        const sumOf = (prefix: string, bin: number) =>
          FEATURE_NAMES.filter((name) => name.startsWith(prefix)).reduce(
            (sum, name) => sum + (frameColumn(frame, name)[bin] as number),
            0,
          );
        for (let bin = 0; bin < 100; bin += 1) {
          expect(Math.abs(sumOf("beat_", bin) - 1)).toBeLessThan(1e-9);
          expect(Math.abs(sumOf("visual_", bin) - 1)).toBeLessThan(1e-9);
          expect(sumOf("format_", bin)).toBe(1);
        }
        FEATURE_SPEC.forEach(({ name, clip }) => {
          const column = frameColumn(frame, name);
          expect(column.every(Number.isFinite), name).toBe(true);
          if (clip) {
            expect(
              column.every((value) => value >= clip[0] && value <= clip[1]),
              name,
            ).toBe(true);
          }
        });
      }),
      { numRuns: 200 },
    );
  });
});

describe("buildBins: rejected input", () => {
  it("needs a positive duration and traffic shares within [0, 1]", () => {
    expect(() => buildBins(golden, 0, channel, null)).toThrow(RangeError);
    expect(() => buildBins(golden, Number.NaN, channel, null)).toThrow(RangeError);
    expect(() => buildBins(golden, 200, channel, { search: 1.2, suggested: 0, browse: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("channelContext", () => {
  it("takes the median target level and the mean newcomer mix", () => {
    expect(
      channelContext(
        [1, 4, 2],
        [
          { search: 0.2, suggested: 0.4, browse: 0.4 },
          { search: 0.4, suggested: 0, browse: 0.6 },
        ],
      ),
    ).toEqual({
      medianTargetLevel: 2,
      mixMean: { search: expect.closeTo(0.3, 12), suggested: 0.2, browse: 0.5 },
    });
    expect(channelContext([1, 2, 3, 5], []).medianTargetLevel).toBe(2.5);
    expect(channelContext([3], []).mixMean).toEqual({ search: 0, suggested: 0, browse: 0 });
    expect(() => channelContext([], [])).toThrow(RangeError);
  });
});

describe("frameRow and frameColumn", () => {
  const frame = buildBins(golden, 200, channel, null);

  it("read the same values from the column-major store", () => {
    const energy = frameColumn(frame, "energy");
    expect(frameRow(frame, 20)[featureIndex("energy")]).toBe(energy[20]);
    expect(() => frameColumn(frame, "nope")).toThrow(RangeError);
    expect(() => frameRow(frame, 100)).toThrow(RangeError);
  });
});
