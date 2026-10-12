// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { videoDocSchema, type VideoBeat } from "@soundcheck/core/schemas";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { chartScales } from "@/lib/chart";
import { AutopsyChart } from "./autopsy-chart";
import type { ChartDrop, ChartSeries } from "./retention-chart";

afterEach(cleanup);

const flat = (start: number) => Array.from({ length: 100 }, (_, i) => start - i * 0.004);
const SERIES: ChartSeries[] = [
  {
    key: "subscribed",
    label: "Subscribers",
    actual: flat(0.9),
    band: { p10: flat(0.85), p50: flat(0.9), p90: flat(0.95) },
  },
  { key: "unsubscribed", label: "Newcomers", actual: flat(0.7), band: null },
];
const beat = (startS: number, endS: number, beatType: VideoBeat["beatType"]): VideoBeat => ({
  startS,
  endS,
  beatType,
  visual: "none",
  talkingHeadShare: 5,
  summary: `A ${beatType}.`,
  transcriptExcerpt: "",
});
const BEATS = [beat(0, 60, "hook"), beat(60, 100, "explanation")];
const DROPS: ChartDrop[] = [
  { id: "late", audience: "subscribed", startS: 70, endS: 75 },
  { id: "early", audience: "unsubscribed", startS: 10, endS: 15 },
  { id: "middle", audience: "subscribed", startS: 40, endS: 45 },
];

/** The chart with the page's state: selecting a drop seeks to its start. */
function Harness({
  onSeek = () => {},
  beats = BEATS,
  series = SERIES,
  durationS = 100,
}: Partial<{
  onSeek: (s: number) => void;
  beats: VideoBeat[];
  series: ChartSeries[];
  durationS: number;
}>) {
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <AutopsyChart
      id="t"
      title="Who is still watching"
      durationS={durationS}
      series={series}
      beats={beats}
      drops={DROPS}
      selectedDropId={selected}
      onSelectDrop={(id) => {
        setSelected(id);
        onSeek(DROPS.find((d) => d.id === id)?.startS ?? 0);
      }}
      onSeek={onSeek}
    />
  );
}

/** The x of each point of an SVG path drawn by d3-shape ("M x,y L x,y …"). */
const xs = (d: string | null) =>
  (d ?? "")
    .split(/[ML]/)
    .filter(Boolean)
    .map((point) => Number(point.split(",")[0]));

describe("AutopsyChart", () => {
  it("draws a beat starting at 60 s and the curve's point at 60 s at the same x", () => {
    const { container } = render(<Harness />);
    const expected = chartScales(640, 100).x(60);
    const beatX = Number(container.querySelector('[data-beat="60"] rect')?.getAttribute("x"));
    const curveX = xs(
      container.querySelector('[data-curve="subscribed"] path')?.getAttribute("d") ?? null,
    )[60];
    expect(beatX).toBeCloseTo(expected, 6);
    expect(curveX).toBeCloseTo(expected, 6);
  });

  it("steps between drop-offs in time order with the arrow keys", () => {
    const onSeek = vi.fn();
    render(<Harness onSeek={onSeek} />);
    const chart = screen.getByRole("group", { name: /arrow keys/ });
    chart.focus();
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(onSeek.mock.calls.map(([s]) => s)).toEqual([10, 40, 70, 70, 40]);
    expect(screen.getByText("Drop-off from 0:40 to 0:45 selected.")).toBeTruthy();
  });

  it("seeks where the chart is clicked", () => {
    const onSeek = vi.fn();
    render(<Harness onSeek={onSeek} />);
    const plot = screen.getByRole("img");
    // jsdom places the SVG at 0, so a click's clientX is its x on the chart.
    fireEvent.click(plot, { clientX: chartScales(640, 100).x(33) });
    expect(onSeek.mock.calls[0]?.[0]).toBeCloseTo(33, 6);
  });

  it("shows one audience at a time, and hides the model on request", () => {
    const { container } = render(<Harness />);
    expect(container.querySelectorAll("[data-curve]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-drop]")).toHaveLength(3);
    fireEvent.click(screen.getByRole("radio", { name: "Newcomers" }));
    expect(
      [...container.querySelectorAll("[data-curve]")].map((g) => g.getAttribute("data-curve")),
    ).toEqual(["unsubscribed"]);
    expect(container.querySelectorAll("[data-drop]")).toHaveLength(1);
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    expect(container.querySelectorAll('path[stroke-dasharray="6 4"]')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Show model" }));
    expect(container.querySelectorAll('path[stroke-dasharray="6 4"]')).toHaveLength(0);
  });

  it("draws a real video the same way every time", () => {
    const doc = videoDocSchema.parse(
      JSON.parse(
        // Tests run from apps/web; under jsdom, import.meta.url is not a file URL.
        readFileSync(
          join(process.cwd(), "fixtures/channels/UC-BHlgFbFh3V76yth-XCmlw/videos/lgxOjPdCGkw.json"),
          "utf8",
        ),
      ),
    );
    const series: ChartSeries[] = (["subscribed", "unsubscribed"] as const).flatMap((key) => {
      const audience = doc.audiences[key];
      return audience
        ? [{ key, label: key, actual: audience.actual, band: audience.predicted }]
        : [];
    });
    const { container } = render(
      <Harness series={series} beats={doc.beats} durationS={doc.durationS} />,
    );
    expect(container.querySelector("svg[role=img]")?.outerHTML).toMatchSnapshot();
  });
});
