import type { Drop } from "@soundcheck/core/schemas";
import { attributionGroupSchema } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { GROUP_EFFECT, dropReason, dropTitle, effectLink, firstDrop } from "./drops";

const drop = (actualLossPp: number, extra: Partial<Drop> = {}): Drop => ({
  audience: "unsubscribed",
  startS: 2.6,
  endS: 10.5,
  binStart: 2,
  binEnd: 4,
  actualLossPp,
  attributions: [],
  residualShare: 1,
  narrative: "Newcomers left.",
  ...extra,
});

describe("drops", () => {
  it("titles a drop-off by how many of which audience left, and when", () => {
    expect(dropTitle(drop(41.9))).toBe("Why 41.9% of newcomers left at 0:03");
    expect(dropTitle(drop(6.06, { audience: "subscribed", startS: 225 }))).toBe(
      "Why 6.1% of subscribers left at 3:45",
    );
  });

  it("shows the largest drop-off first", () => {
    expect(firstDrop([drop(6.2), drop(41.9, { binStart: 9 }), drop(7.1)])?.binStart).toBe(9);
    expect(firstDrop([])).toBeNull();
  });

  it("answers why in a sentence, with the chips' numbers", () => {
    const position = { group: "position", label: "Position in video", share: 0.13 } as const;
    const payoff = { group: "payoff", label: "Waiting for the payoff", share: 0.03 } as const;
    const sponsor = { group: "sponsor", label: "Sponsor segment", share: 0.4 } as const;
    expect(dropReason(drop(1, { attributions: [position, payoff], residualShare: 0.84 }))).toBe(
      "The model links 13% of this drop to its position in the video and 3% to waiting for the payoff. It can't explain the other 84%.",
    );
    expect(
      dropReason(drop(1, { attributions: [sponsor, position, payoff], residualShare: 0.44 })),
    ).toBe(
      "The model links 40% of this drop to the sponsor segment, 13% to its position in the video and 3% to waiting for the payoff. It can't explain the other 44%.",
    );
    expect(
      dropReason(drop(1, { attributions: [{ ...sponsor, share: 0.998 }], residualShare: 0.002 })),
    ).toBe("The model links 100% of this drop to the sponsor segment.");
    expect(dropReason(drop(1))).toBe("The model can't explain this drop yet.");
  });

  it("links every editable cause to its effect, and position nowhere", () => {
    for (const group of attributionGroupSchema.options) {
      expect(GROUP_EFFECT[group] === undefined).toBe(group === "position");
    }
    expect(effectLink(drop(1), "sponsor")).toBe(
      "/app/audiences?audience=unsubscribed&effect=beat_sponsor",
    );
    expect(effectLink(drop(1), "position")).toBeNull();
  });
});
