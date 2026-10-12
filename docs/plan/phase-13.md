# Phase 13 — Video autopsy screen

**Goal.** The signature visualization: retention curves per audience, aligned on one time axis with the beat strip beneath them, and each drop explained with attributed causes and an honest residual. Clicking a drop plays that moment.

**Depends on.** Phases 11 and 12. Also read docs/plan/design-system.md. Day: Oct 13.

## Stack

- D3 modules only for math (`d3-scale`, `d3-shape`, `d3-array`); React renders the SVG
- A `useResizeObserver` hook for responsive width
- YouTube IFrame Player API for the embedded player
- Vitest and Testing Library

## Build

1. `/app/videos`: one-read list from the index document. Columns: title, published, duration, average view percentage, and a flag chip such as "biggest drop at 4:32". Client-side sort and filter.
2. `/app/videos/[videoId]`: header with title and stats, then the chart, then the drop panel; the player sits beside the chart on desktop and below it on mobile.
3. `<RetentionChart>`:
   - x is seconds from 0 to duration, ticks formatted m:ss; y is percent still watching from 0 to 100 (values above 100 from rewatches are clipped visually).
   - Per audience: actual curve as a solid line in the audience color; predicted median dashed; 10th to 90th percentile band at low opacity. A Show model toggle hides predictions.
   - Audience toggle chips: subscribers, newcomers, all.
   - Drop windows as shaded vertical bands; hover highlights, click selects.
   - An in-sample indicator: "This video was used to train your model" or "Held-out: predicted before we looked". Held-out videos are your proof; label them.
4. `<BeatStrip>` below the chart, sharing the exact same x scale. Beats are colored by group (opening, content, promotion, closing, tangent) with a legend. Hover shows the beat summary and the first 140 characters of its transcript.
5. Clicking anywhere on the chart or strip seeks the embedded player to that second. Arrow keys move between drops.
6. `<DropPanel>`: title such as "Why 38% of newcomers left at 4:32", the narrative, attribution chips with shares including "Unexplained", and a link to the related trait on the audiences screen.
7. Performance: memoize scales and paths; keep each path under 600 points.
8. Tests: a beat starting at 60 s and the curve point at 60 s render at the same x; snapshot of the chart for one fixture; keyboard navigation between drops.

## Decisions and gotchas

- Hand-rolled SVG instead of a chart library because the strip and curve must share one scale, bands and hover state. Libraries make this harder, not easier.
- On narrow screens, chart and strip scroll horizontally together inside one container.

## Do not

- Hide the residual chip when it is large. A large unexplained share is information.

## Done when

- [ ] The autopsy works for every video of a real channel
- [ ] Clicking a drop seeks the player correctly
- [ ] Fixtures mode matches the real API rendering
- [ ] Usable at 390 px
- [ ] `docs/notes/phase-13.md` written with screenshots
