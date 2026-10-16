import type {
  Chapter,
  Edit,
  SimulatedSpan,
  SoundcheckPrediction,
  VideoBeat,
} from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import {
  chaptersText,
  cutList,
  deltaOf,
  formatDelta,
  isSure,
  marksFor,
  rankEdits,
  recommendingOf,
  timecode,
  toEdited,
  toOriginal,
} from "./edits";

const p = (p10: number, p50: number, p90: number) => ({ p10, p50, p90 });
const edit = (overrides: Partial<Edit>): Edit => ({
  editId: "remove-2",
  edit: { op: "remove", beat: 2 },
  startS: 80,
  endS: 130,
  label: "Cut the tangent at 1:20 (50 s)",
  rationale: "Newcomers are predicted to leave faster during it.",
  deltaAvdS: p(8.2, 9.5, 10.7),
  deltaAvpPp: p(12.4, 13.3, 13.9),
  audienceDriver: "unsubscribed",
  recommended: false,
  ...overrides,
});
const beat = (startS: number, endS: number): VideoBeat => ({
  startS,
  endS,
  beatType: "explanation",
  visual: "none",
  talkingHeadShare: 3,
  summary: "",
  transcriptExcerpt: "",
});
const beats = [
  beat(0, 20),
  beat(20, 80),
  beat(80, 130),
  beat(130, 160),
  beat(160, 200),
  beat(200, 240),
];

describe("edit effects", () => {
  it("read with their intervals, in seconds or points", () => {
    expect(formatDelta(p(8.2, 12.4, 16.1), "avd")).toBe("+12 s (8.2 s to 16 s)");
    expect(formatDelta(p(-3, 4.2, 70), "avd")).toBe("+4.2 s (−3.0 s to 1:10)");
    expect(formatDelta(p(-0.4, -0.2, 0), "avd")).toBe("−0.2 s (−0.4 s to 0 s)");
    expect(formatDelta(p(1.1, 3.24, 5), "avp")).toBe("+3.2 pp (1.1 to 5.0)");
  });

  it("are sure only when the whole interval is above zero, and rank by the objective", () => {
    expect(isSure(p(0.1, 2, 3))).toBe(true);
    expect(isSure(p(-0.1, 2, 3))).toBe(false);
    const move = edit({
      editId: "move-4-to-1",
      deltaAvdS: p(11.8, 12.4, 13),
      deltaAvpPp: p(5, 5.2, 5.4),
    });
    const cut = edit({});
    expect(rankEdits([cut, move], "avd").map((e) => e.editId)).toEqual(["move-4-to-1", "remove-2"]);
    expect(rankEdits([move, cut], "avp").map((e) => e.editId)).toEqual(["remove-2", "move-4-to-1"]);
    expect(deltaOf(cut, "avp")).toEqual(cut.deltaAvpPp);
  });
});

describe("cut list", () => {
  it("lists ticked edits in the cut's own times, earliest first", () => {
    const csv = cutList(
      [
        edit({}),
        edit({
          editId: "trim-1",
          edit: { op: "trim", beat: 1, keep: 0.5 },
          startS: 20,
          endS: 80,
          label: "Trim the explanation at 0:20 to 30 s",
        }),
        edit({
          editId: "move-4-to-1",
          edit: { op: "move", beat: 4, to: 1 },
          startS: 160,
          endS: 200,
          label: 'Move the "payoff" at 2:40 to 0:20',
        }),
        edit({
          editId: "move-3-to-6",
          edit: { op: "move", beat: 3, to: 6 },
          startS: 130,
          endS: 160,
          label: "Move the call to action at 2:10 to 3:30",
        }),
      ],
      beats,
      240,
    );
    expect(csv.split("\n")).toEqual([
      "start,end,action,note",
      "0:50.0,1:20.0,Cut,Trim the explanation at 0:20 to 30 s",
      "1:20.0,2:10.0,Cut,Cut the tangent at 1:20 (50 s)",
      "2:10.0,2:40.0,Move,Move the call to action at 2:10 to 3:30: place it to the end",
      '2:40.0,3:20.0,Move,"Move the ""payoff"" at 2:40 to 0:20: place it before 0:20.0"',
    ]);
    expect(timecode(80.04)).toBe("1:20.0");
    expect(timecode(3599.96)).toBe("60:00.0");
  });
});

describe("chapters", () => {
  const chapters: Chapter[] = [
    { firstBeat: 0, title: "Will it hold?" },
    { firstBeat: 1, title: "How beams work" },
    { firstBeat: 3, title: "The drive across" },
    { firstBeat: 5, title: "What's next" },
  ];

  it("give the cut as it is its chapters, from 0:00", () => {
    expect(chaptersText(chapters, beats, null, 240)).toEqual({
      text: "0:00 Will it hold?\n0:20 How beams work\n2:10 The drive across\n3:20 What's next",
    });
  });

  it("follow the edited cut: re-timed, without chapters that were cut", () => {
    // Beats 3 and 4 cut, beat 1 moved to the end.
    const spans = [
      { beat: 0, startS: 0, endS: 20, fromS: 0, toS: 20, edit: null },
      { beat: 2, startS: 20, endS: 70, fromS: 80, toS: 130, edit: null },
      { beat: 5, startS: 70, endS: 110, fromS: 200, toS: 240, edit: null },
      { beat: 1, startS: 110, endS: 170, fromS: 20, toS: 80, edit: "move" as const },
    ];
    expect(chaptersText(chapters, beats, spans, 170)).toEqual({
      text: "0:00 Will it hold?\n0:20 How beams work\n1:10 What's next",
    });
  });

  it("move with a beat that opens one, but not with a beat moved out of the middle of one", () => {
    // Beat 5 opens "What's next", and moves before beat 1, as a payoff moves earlier.
    const opener = [
      { beat: 0, startS: 0, endS: 20, fromS: 0, toS: 20, edit: null },
      { beat: 5, startS: 20, endS: 60, fromS: 200, toS: 240, edit: "move" as const },
      { beat: 1, startS: 60, endS: 120, fromS: 20, toS: 80, edit: null },
      { beat: 2, startS: 120, endS: 170, fromS: 80, toS: 130, edit: null },
      { beat: 3, startS: 170, endS: 200, fromS: 130, toS: 160, edit: null },
      { beat: 4, startS: 200, endS: 240, fromS: 160, toS: 200, edit: null },
    ];
    expect(chaptersText(chapters, beats, opener, 240)).toEqual({
      text: "0:00 Will it hold?\n0:20 What's next\n1:00 How beams work\n2:50 The drive across",
    });
    // Beat 2 sits inside "How beams work", and moves before beat 1.
    const inside = [
      { beat: 0, startS: 0, endS: 20, fromS: 0, toS: 20, edit: null },
      { beat: 2, startS: 20, endS: 70, fromS: 80, toS: 130, edit: "move" as const },
      { beat: 1, startS: 70, endS: 130, fromS: 20, toS: 80, edit: null },
      { beat: 3, startS: 130, endS: 160, fromS: 130, toS: 160, edit: null },
      { beat: 4, startS: 160, endS: 200, fromS: 160, toS: 200, edit: null },
      { beat: 5, startS: 200, endS: 240, fromS: 200, toS: 240, edit: null },
    ];
    expect(chaptersText(chapters, beats, inside, 240)).toEqual({
      text: "0:00 Will it hold?\n1:10 How beams work\n2:10 The drive across\n3:20 What's next",
    });
  });

  it("fold chapters under 10 s into the one before, and say when YouTube's three cannot be met", () => {
    const short = [beat(0, 5), beat(5, 100), beat(100, 104), beat(104, 200)];
    expect(
      chaptersText(
        [
          { firstBeat: 0, title: "Intro" },
          { firstBeat: 1, title: "Main" },
          { firstBeat: 2, title: "Blip" },
          { firstBeat: 3, title: "End" },
        ],
        short,
        null,
        200,
      ),
    ).toEqual({
      problem: "YouTube needs at least 3 chapters of 10 seconds or more; this cut has 2.",
    });
    expect(chaptersText([{ firstBeat: 0, title: "All" }], beats, null, 3700)).toEqual({
      problem: "YouTube needs at least 3 chapters of 10 seconds or more; this cut has 1.",
    });
  });
});

describe("times in the edited cut", () => {
  /** The explanation trimmed to 25 s, and the sponsor moved before the payoff. */
  const spans: SimulatedSpan[] = [
    { beat: 0, startS: 0, endS: 8, fromS: 0, toS: 8, edit: null },
    { beat: 1, startS: 8, endS: 20, fromS: 8, toS: 20, edit: null },
    { beat: 2, startS: 20, endS: 45, fromS: 20, toS: 70, edit: "trim" },
    { beat: 4, startS: 45, endS: 115, fromS: 100, toS: 170, edit: null },
    { beat: 3, startS: 115, endS: 145, fromS: 70, toS: 100, edit: "move" },
    { beat: 5, startS: 145, endS: 175, fromS: 170, toS: 200, edit: null },
    { beat: 6, startS: 175, endS: 187, fromS: 200, toS: 212, edit: null },
  ];

  it("map to the cut as it is, to seek the video", () => {
    expect(toOriginal(spans, 30)).toBe(30);
    expect(toOriginal(spans, 50)).toBe(105);
    expect(toOriginal(spans, 120)).toBe(75);
    expect(toOriginal(spans, 187)).toBe(212);
    expect(toOriginal(spans, -1)).toBeNull();
  });

  it("come back from the cut as it is, except where it was cut", () => {
    expect(toEdited(spans, 30)).toBe(30);
    expect(toEdited(spans, 75)).toBe(120);
    expect(toEdited(spans, 105)).toBe(50);
    expect(toEdited(spans, 50)).toBeNull();
    for (const t of [0, 12, 44, 60, 130, 186]) {
      expect(toEdited(spans, toOriginal(spans, t) as number)).toBeCloseTo(t);
    }
  });

  it("mark what each edit does to its beat", () => {
    expect(
      marksFor([
        { edit: { op: "remove", beat: 1 } },
        { edit: { op: "trim", beat: 2, keep: 0.5 } },
        { edit: { op: "move", beat: 3, to: 5 } },
      ]),
    ).toEqual(
      new Map([
        [1, { cutFrom: 0 }],
        [2, { cutFrom: 0.5 }],
        [3, { moved: true }],
      ]),
    );
  });
});

describe("recommending", () => {
  const model = (usable: boolean) => ({
    runId: "r",
    usable,
    unusableReasons: usable ? [] : ["trained on 2 videos; at least 20 are needed"],
    trainedVideos: usable ? 8 : 2,
  });
  const prediction = (subscribers: boolean, newcomers: boolean) =>
    ({
      audiences: {
        subscribed: { model: model(subscribers) },
        unsubscribed: { model: model(newcomers) },
      },
    }) as unknown as SoundcheckPrediction;

  it("recommends on every audience when every model is usable", () => {
    expect(recommendingOf(prediction(true, true), ["subscribed", "unsubscribed"])).toEqual({
      kind: "all",
    });
    expect(recommendingOf(prediction(true, true), null)).toEqual({ kind: "all" });
  });

  it("recommends on the audiences the job judged on, naming those left out", () => {
    expect(recommendingOf(prediction(false, true), ["unsubscribed"])).toEqual({
      kind: "some",
      on: ["Newcomers"],
      without: ["Subscribers"],
    });
  });

  it("says why nothing is recommended", () => {
    expect(recommendingOf(prediction(false, false), ["subscribed", "unsubscribed"])).toEqual({
      kind: "none",
      why: "not-usable",
    });
    // Usable subscribers alone bring too few of the views, so the job judged on everyone.
    expect(recommendingOf(prediction(true, false), ["subscribed", "unsubscribed"])).toEqual({
      kind: "none",
      why: "too-few-views",
    });
    // Soundchecks from before needed every model to be usable.
    expect(recommendingOf(prediction(false, true), null)).toEqual({
      kind: "none",
      why: "not-usable",
    });
    expect(recommendingOf(null, null)).toEqual({ kind: "none", why: "not-usable" });
  });
});
