/**
 * Writes tests/fixtures/parity/frame.json: the feature frame of a made-up
 * five-minute tutorial for newcomers, built by the TypeScript featurizer.
 * `services/modeling/scripts/parity_fixture.py` then fits a model and writes
 * the artifact and the hazards Python predicts for this frame; the runtime
 * must match them within 1e-9. Run in that order:
 *   pnpm --filter @soundcheck/scripts parity-frame
 *   (cd services/modeling && uv run python scripts/parity_fixture.py)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildBins, type FeatureBeat, type FeatureVideo } from "@soundcheck/core/features";

const beat = (
  start_s: number,
  end_s: number,
  beat_type: FeatureBeat["beat_type"],
  overrides: Partial<FeatureBeat> = {},
): FeatureBeat => ({
  start_s,
  end_s,
  beat_type,
  talking_head_share: 5,
  visual: "none",
  cuts_per_min: 2,
  on_screen_text: false,
  music: "none",
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  transcript: "Some words spoken here.",
  words_per_minute: 150,
  ...overrides,
});

const video: FeatureVideo = {
  format: "tutorial",
  target_level: 3,
  payoff_time_s: 240,
  beats: [
    beat(0, 12, "hook", { energy: 4, opens_loop: "Can it be done in five minutes?" }),
    beat(12, 30, "intro_branding", {
      talking_head_share: 1,
      visual: "graphics",
      music: "foreground",
      cuts_per_min: 20,
      transcript: "",
      words_per_minute: 0,
    }),
    beat(30, 95, "setup", { info_density: 2 }),
    beat(95, 125, "sponsor", { energy: 4, on_screen_text: true, words_per_minute: 170 }),
    beat(125, 230, "demonstration", {
      talking_head_share: 2,
      visual: "screen_recording",
      cuts_per_min: 8,
      on_screen_text: true,
      assumed_knowledge: 4,
      info_density: 4,
    }),
    beat(230, 270, "payoff", { closes_loop: true, energy: 5 }),
    beat(270, 290, "cta", { music: "background" }),
    beat(290, 300, "end_screen", {
      visual: "graphics",
      talking_head_share: 1,
      transcript: "",
      words_per_minute: 0,
    }),
  ],
};

const frame = buildBins(
  video,
  300,
  { medianTargetLevel: 2, mixMean: { search: 0.2, suggested: 0.3, browse: 0.4 } },
  { search: 0.5, suggested: 0.2, browse: 0.2 },
);

const dir = new URL("../tests/fixtures/parity/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(
  new URL("frame.json", dir),
  `${JSON.stringify(
    {
      description: "A five-minute tutorial for newcomers, from scripts/parity-frame.ts",
      audience: "unsubscribed",
      rows: frame.rows,
      columns: frame.columns,
      values: Array.from(frame.values),
    },
    null,
    2,
  )}\n`,
);
console.log(`wrote tests/fixtures/parity/frame.json (${frame.rows} x ${frame.columns.length})`);
