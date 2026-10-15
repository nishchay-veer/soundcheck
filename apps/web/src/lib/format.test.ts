import { describe, expect, it } from "vitest";
import { formatClock, formatCount, formatPercent, formatShare, plain, signed } from "./format";

describe("number formats", () => {
  it("gives percentage points one decimal, a sign and a true minus", () => {
    expect(signed(4.24)).toBe("+4.2");
    expect(signed(-2.13)).toBe("−2.1");
    expect(signed(-0.04)).toBe("0.0");
    expect(plain(-3.4)).toBe("−3.4");
    expect(plain(2.06)).toBe("2.1");
  });

  it("rounds shares to whole percentages and view percentages to one decimal", () => {
    expect(formatShare(0.617)).toBe("62%");
    expect(formatShare(0.2727)).toBe("27%");
    expect(formatPercent(41.27)).toBe("41.3%");
    expect(formatCount(1204)).toBe("1,204");
  });

  it("writes times as M:SS without a 60th second", () => {
    expect(formatClock(59.6)).toBe("1:00");
    expect(formatClock(71.6)).toBe("1:12");
    expect(formatClock(3725)).toBe("62:05");
  });
});
