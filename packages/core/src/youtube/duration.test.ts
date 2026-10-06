import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseIsoDuration } from "./duration";

describe("parseIsoDuration", () => {
  it.each([
    ["PT31S", 31],
    ["PT1M28S", 88],
    ["PT4M22S", 262],
    ["PT2M", 120],
    ["PT1H", 3_600],
    ["PT3H0M1S", 10_801],
    ["P1DT2H3M4S", 93_784],
    ["P1W", 604_800],
    ["P0D", 0],
    ["PT0S", 0],
    ["PT1.9S", 1],
  ])("%s is %i s", (value, seconds) => {
    expect(parseIsoDuration(value)).toBe(seconds);
  });

  it.each(["", "P", "PT", "P1DT", "1H", "PT1H2", "P1Y", "P1M", "PT-1S", "PT1S2M"])(
    "rejects %j",
    (value) => {
      expect(() => parseIsoDuration(value)).toThrow(RangeError);
    },
  );

  it("reads back any duration written in the API's form", () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 30 }),
        fc.nat({ max: 23 }),
        fc.nat({ max: 59 }),
        fc.nat({ max: 59 }),
        (d, h, m, s) => {
          const time = `${h ? `${h}H` : ""}${m ? `${m}M` : ""}${s ? `${s}S` : ""}`;
          const value = `P${d ? `${d}D` : ""}${time ? `T${time}` : d ? "" : "T0S"}`;
          expect(parseIsoDuration(value)).toBe(d * 86_400 + h * 3_600 + m * 60 + s);
        },
      ),
    );
  });
});
