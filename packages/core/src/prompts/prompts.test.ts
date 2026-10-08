import { describe, expect, it } from "vitest";
import { beatTypeSchema, framingSchema, videoFormatSchema } from "../schemas/beats";
import {
  BEAT_EXAMPLES,
  BEAT_EXAMPLE_FILES,
  EXTRACT_BEATS_INSTRUCTIONS,
  beatExtractionPrompt,
  extractBeatsPrompt,
} from "./index";

describe("extraction prompt", () => {
  it.each([...beatTypeSchema.options, ...framingSchema.options, ...videoFormatSchema.options])(
    "explains the label %s",
    (label) => {
      expect(EXTRACT_BEATS_INSTRUCTIONS).toContain(label);
    },
  );

  it("anchors every 1-to-5 scale at 1, 3 and 5", () => {
    for (const scale of ["energy", "assumed_knowledge", "info_density", "target_level"]) {
      const section = EXTRACT_BEATS_INSTRUCTIONS.split(`${scale},`)[1]?.split("\n\n")[0] ?? "";
      expect(section).toMatch(/- 1: .+\n- 3: .+\n- 5: .+/);
    }
  });

  it("asks for M:SS timestamps and never for analytics", () => {
    expect(EXTRACT_BEATS_INSTRUCTIONS).toContain('"M:SS"');
    expect(EXTRACT_BEATS_INSTRUCTIONS).toMatch(/Do not estimate retention/);
  });

  it("appends the examples after the rules", () => {
    const prompt = beatExtractionPrompt();
    expect(prompt.startsWith(EXTRACT_BEATS_INSTRUCTIONS)).toBe(true);
    expect(prompt).toContain("## Example 2:");
    expect(extractBeatsPrompt([])).toBe(EXTRACT_BEATS_INSTRUCTIONS);
  });
});

describe("few-shot examples", () => {
  it("parse against the wire schema", () => {
    expect(BEAT_EXAMPLES).toHaveLength(2);
  });

  it.each(Object.entries(BEAT_EXAMPLE_FILES))(
    "%s has been reviewed by a person who watched the video",
    (_, example) => {
      expect(example.reviewed).toBe(true);
    },
  );
});
