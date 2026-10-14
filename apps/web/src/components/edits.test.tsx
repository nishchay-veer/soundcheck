// @vitest-environment jsdom
import type { Edit, SimulatedSpan } from "@soundcheck/core/schemas";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_BEATS, SAMPLE_SOUNDCHECK } from "@/app/styleguide/samples";
import { CutExports } from "./cut-exports";
import { CutStrip } from "./cut-strip";
import { EditPanel } from "./edit-panel";

const EDITS = SAMPLE_SOUNDCHECK.edits;
const edit = (id: string) => EDITS.find((candidate) => candidate.editId === id) as Edit;
/** Another edit on the sponsor's beat, which cannot go with moving it. */
const TRIM_SPONSOR: Edit = {
  ...edit("move-3-to-5"),
  editId: "trim-3",
  edit: { op: "trim", beat: 3, keep: 0.5 },
  label: "Trim the sponsor read at 1:10 to 15 s",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EditPanel", () => {
  const panel = (props: Partial<ComponentProps<typeof EditPanel>> = {}) => {
    const handlers = { onObjective: vi.fn(), onToggle: vi.fn() };
    const view = render(
      <EditPanel
        edits={EDITS}
        objective="avd"
        ticked={new Set()}
        usable
        together={null}
        pending={false}
        error={null}
        {...handlers}
        {...props}
      />,
    );
    return { ...handlers, ...view };
  };
  const labels = () =>
    screen
      .getAllByRole("checkbox")
      .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent);
  const card = (label: RegExp) => screen.getByLabelText(label).closest("li") as HTMLElement;

  it("ranks edits by the chosen objective, each with its time, reason and effect", async () => {
    const user = userEvent.setup();
    const { onObjective, rerender } = panel();
    expect(labels()).toEqual([
      "Move the sponsor read at 1:10 to 2:20",
      "Move the payoff at 2:50 to 0:20",
      "Trim the explanation at 0:20 to 25 s",
      "Cut the call to action at 3:20 (12 s)",
    ]);
    const sponsor = card(/Move the sponsor read/);
    expect(sponsor.textContent).toContain("1:10 · Later in the video");
    expect(sponsor.textContent).toContain("+6.4 s (3.1 s to 9.8 s)(sure)");
    // Its interval reaches below zero: it may do nothing.
    expect(card(/Trim the explanation/).textContent).toContain(
      "+2.1 s (−1.2 s to 5.0 s)(uncertain)· uncertain",
    );

    await user.click(screen.getByRole("radio", { name: "% of the cut" }));
    expect(onObjective).toHaveBeenCalledWith("avp");
    rerender(
      <EditPanel
        edits={EDITS}
        objective="avp"
        onObjective={onObjective}
        ticked={new Set()}
        onToggle={vi.fn()}
        usable
        together={null}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByRole("radio", { name: "% of the cut" }).getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(labels()[0]).toBe("Trim the explanation at 0:20 to 25 s");
    expect(card(/Trim the explanation/).textContent).toContain("+3.4 pp (1.1 to 5.6)(sure)");
  });

  it("marks what is recommended, and recommends nothing while the model is not usable", () => {
    const { rerender } = panel({
      edits: EDITS.map((one) => ({ ...one, recommended: one.editId === "move-3-to-5" })),
    });
    expect(within(card(/Move the sponsor read/)).getByText("Recommended")).toBeTruthy();
    expect(screen.getAllByText("Recommended")).toHaveLength(1);
    expect(screen.queryByText("Not a result yet")).toBeNull();

    rerender(
      <EditPanel
        edits={EDITS}
        objective="avd"
        onObjective={vi.fn()}
        ticked={new Set()}
        onToggle={vi.fn()}
        usable={false}
        together={null}
        pending={false}
        error={null}
      />,
    );
    expect(screen.getByText("Not a result yet")).toBeTruthy();
    expect(screen.queryByText("Recommended")).toBeNull();
    // It can still be tried.
    expect(
      screen.getAllByRole("checkbox").every((box) => !(box as HTMLInputElement).disabled),
    ).toBe(true);
  });

  it("toggles edits, and blocks another edit on a beat that is already changed", async () => {
    const user = userEvent.setup();
    const { onToggle } = panel({
      edits: [...EDITS, TRIM_SPONSOR],
      ticked: new Set(["move-3-to-5"]),
    });
    const trim = screen.getByLabelText(/Trim the sponsor read/) as HTMLInputElement;
    expect(trim.disabled).toBe(true);
    expect(card(/Trim the sponsor read/).textContent).toContain(
      "Another ticked edit already changes this beat.",
    );
    expect((screen.getByLabelText(/Move the sponsor read/) as HTMLInputElement).checked).toBe(true);
    await user.click(screen.getByLabelText(/Move the payoff/));
    expect(onToggle).toHaveBeenCalledWith("move-5-to-2");
  });

  it("says what the ticked edits do together, while they are simulated, and what failed", () => {
    const { rerender } = panel();
    const live = () => screen.getByText(/Tick edits|Simulating|With \d|could not/);
    expect(live().textContent).toBe("Tick edits to see the cut with them.");
    const state = (props: Partial<ComponentProps<typeof EditPanel>>) =>
      rerender(
        <EditPanel
          edits={EDITS}
          objective="avd"
          onObjective={vi.fn()}
          ticked={new Set(["move-3-to-5", "trim-2"])}
          onToggle={vi.fn()}
          usable
          together={null}
          pending={false}
          error={null}
          {...props}
        />,
      );
    state({ pending: true });
    expect(live().textContent).toBe("Simulating…");
    state({
      together: {
        avdS: { p10: 4.2, p50: 8.1, p90: 12.3 },
        avpPp: { p10: 2.1, p50: 4.5, p90: 6.9 },
      },
    });
    expect(live().textContent).toBe("With 2 edits: +8.1 s (4.2 s to 12 s)(sure)");
    state({ error: "These edits could not be simulated. Please try again." });
    expect(live().textContent).toBe("These edits could not be simulated. Please try again.");
  });

  it("says when no edit helps", () => {
    panel({ edits: [] });
    expect(screen.getByText(/No edit is predicted to keep viewers longer/)).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("CutExports", () => {
  /** The cut with the sponsor moved before the payoff and the explanation trimmed by half. */
  const SPANS: SimulatedSpan[] = [
    { beat: 0, startS: 0, endS: 8, fromS: 0, toS: 8, edit: null },
    { beat: 1, startS: 8, endS: 20, fromS: 8, toS: 20, edit: null },
    { beat: 2, startS: 20, endS: 45, fromS: 20, toS: 70, edit: "trim" },
    { beat: 4, startS: 45, endS: 115, fromS: 100, toS: 170, edit: null },
    { beat: 3, startS: 115, endS: 145, fromS: 70, toS: 100, edit: "move" },
    { beat: 5, startS: 145, endS: 175, fromS: 170, toS: 200, edit: null },
    { beat: 6, startS: 175, endS: 187, fromS: 200, toS: 212, edit: null },
  ];
  const exports = (props: Partial<ComponentProps<typeof CutExports>> = {}) =>
    render(
      <CutExports
        title="How I built a guitar in a weekend"
        edits={[]}
        beats={SAMPLE_BEATS}
        durationS={212}
        chapters={SAMPLE_SOUNDCHECK.chapters}
        spans={null}
        editedDurationS={212}
        {...props}
      />,
    );
  const box = (heading: string) =>
    screen.getByRole("heading", { name: heading }).parentElement as HTMLElement;

  it("gives chapters for the cut as it is before any edit is ticked", async () => {
    const user = userEvent.setup();
    exports();
    expect(box("Cut list").textContent).toContain("Tick edits to build a cut list.");
    expect(within(box("Chapters for YouTube")).getByText(/^0:00/).textContent).toBe(
      "0:00 Will it play in tune?\n0:20 Shaping the neck\n1:40 The first chords",
    );
    await user.click(within(box("Chapters for YouTube")).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(
      "0:00 Will it play in tune?\n0:20 Shaping the neck\n1:40 The first chords",
    );
    expect(screen.getByText("Copied the chapters.")).toBeTruthy();
  });

  it("lists the ticked edits in the cut's own times, to copy or download", async () => {
    const user = userEvent.setup();
    const created: Blob[] = [];
    const downloads: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      created.push(blob as Blob);
      return "blob:cut-list";
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });
    exports({
      edits: [edit("move-3-to-5"), edit("trim-2")],
      spans: SPANS,
      editedDurationS: 187,
    });
    const csv = [
      "start,end,action,note",
      "0:45.0,1:10.0,Cut,Trim the explanation at 0:20 to 25 s",
      "1:10.0,1:40.0,Move,Move the sponsor read at 1:10 to 2:20: place it before 2:50.0",
    ].join("\n");
    expect(within(box("Cut list")).getByText(/^start,end/).textContent).toBe(csv);
    await user.click(within(box("Cut list")).getByRole("button", { name: "Copy" }));
    expect(await navigator.clipboard.readText()).toBe(csv);
    expect(screen.getByText("Copied the cut list.")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(downloads).toEqual(["how-i-built-a-guitar-in-a-weekend-cut-list.csv"]);
    expect(await created[0]?.text()).toBe(csv);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:cut-list");

    // Chapters follow the edited cut: the moved sponsor starts no chapter.
    expect(box("Chapters for YouTube").textContent).toContain("For the cut with the ticked edits.");
    expect(within(box("Chapters for YouTube")).getByText(/^0:00/).textContent).toBe(
      "0:00 Will it play in tune?\n0:20 Shaping the neck\n0:45 The first chords",
    );
  });

  it("gives the chapters of the cut as it is until the ticked edits are simulated", () => {
    exports({ edits: [edit("move-3-to-5")], spans: null });
    expect(box("Chapters for YouTube").textContent).toContain("For the cut as it is.");
    expect(within(box("Chapters for YouTube")).getByText(/^0:00/).textContent).toBe(
      "0:00 Will it play in tune?\n0:20 Shaping the neck\n1:40 The first chords",
    );
  });

  it("says when the cut cannot have chapters on YouTube", () => {
    exports({
      chapters: [
        { firstBeat: 0, title: "Hook" },
        { firstBeat: 1, title: "Intro" },
        { firstBeat: 2, title: "The build" },
      ],
    });
    expect(box("Chapters for YouTube").textContent).toContain(
      "YouTube needs at least 3 chapters of 10 seconds or more; this cut has 2.",
    );
    expect(within(box("Chapters for YouTube")).queryByRole("button")).toBeNull();
  });

  it("says when the soundcheck has no chapters", () => {
    exports({ chapters: null });
    expect(screen.getByText("No chapters for this soundcheck.")).toBeTruthy();
  });
});

describe("CutStrip", () => {
  it("hatches what is cut and marks what moves, for screen readers too", async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    const { container } = render(
      <CutStrip
        beats={SAMPLE_BEATS}
        durationS={212}
        marks={
          new Map([
            [1, { cutFrom: 0 }],
            [2, { cutFrom: 0.5 }],
            [3, { moved: true as const }],
          ])
        }
        onSeek={onSeek}
      />,
    );
    const whole = container.querySelector('[data-cut="1"]');
    const half = container.querySelector('[data-cut="2"]');
    const beat = container.querySelector('[data-beat="20"] rect');
    expect(whole && half && beat).toBeTruthy();
    expect(Number(half?.getAttribute("width"))).toBeCloseTo(
      Number(beat?.getAttribute("width")) / 2,
    );
    expect(container.querySelector('[data-moved="3"]')).toBeTruthy();
    expect(container.querySelector('[data-cut="3"], [data-moved="1"]')).toBeNull();

    const beats = within(screen.getByRole("list", { name: "Beats" })).getAllByRole("listitem");
    expect(beats[1]?.textContent).toMatch(/^Branded intro, 0:08 to 0:20 \(cut\):/);
    expect(beats[2]?.textContent).toMatch(/0:20 to 1:10 \(cut after the first 50%\):/);
    expect(beats[3]?.textContent).toMatch(/1:10 to 1:40 \(moved\):/);
    expect(beats[4]?.textContent).not.toContain("(");

    await user.click(container.querySelector("svg") as SVGElement);
    expect(onSeek).toHaveBeenCalled();
  });
});
