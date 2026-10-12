# Phase 13 — Video autopsy screen

**Goal.** The signature visualization: retention curves per audience, aligned on one time axis with the beat strip beneath them, and each drop explained with attributed causes and an honest residual. Clicking a drop plays that moment.

**Depends on.** Phases 11 and 12. Also read docs/plan/design-system.md. Day: Oct 13.

## Stack

- D3 modules only for math (`d3-scale`, `d3-shape`; `d3-array` is installed but unused); React renders the SVG
- A `useResizeObserver` hook for responsive width
- YouTube IFrame Player API for the embedded player, from youtube-nocookie.com
- Vitest and Testing Library; the Playwright smoke test from Phase 12

## Build

1. **Beat snippets in the documents:** each beat in a video page gains `transcriptExcerpt`, its speech collapsed to at most 140 characters and cut at a word (empty when silent). `PUBLISH_VERSION` becomes `serving-v3`; republish and re-export the fixtures.
2. **`/app/videos`:** one read of the index document. Each row: thumbnail, title (with a "Held out" badge when the video did not train the model), published date, length, average view percentage, and a chip such as "Biggest drop at 0:17". Client-side search and five sorts: newest, oldest, most watched through, biggest drop-off, longest.
3. **`/app/videos/[videoId]`:**
   - header: "All videos", the title, date and length, and the in-sample badge: "This video was used to train your model", or "Held out: predicted before we looked". Held-out videos are your proof; label them.
   - three numbers (views, average watch, average view), stacked on a phone; the "Not a result yet" note while the models are not usable;
   - the chart and beat strip with the player beside them on desktop and below on a phone, then the drop panel;
   - a loading skeleton and a "Video not found" page.
4. **`<RetentionChart>`:**
   - x is seconds from 0 to duration, ticks at round steps formatted m:ss; y is percent still watching from 0 to 100 (rewatches above 100 are clipped);
   - per audience, the actual curve as a solid line in the audience color, the predicted median dashed, and the 10th to 90th percentile band at low opacity. A Show model toggle hides predictions;
   - audience chips: Subscribers, Newcomers, Both (there is no all-viewers curve);
   - drop windows as shaded, hatched vertical bands; hover highlights, click selects;
   - a playhead that follows the player.
5. **`<BeatStrip>`** below the chart, sharing the exact same x scale. Beats are colored by group (opening, content, promotion, closing in light grey, tangent white with a dashed outline), with a legend of the groups the video has. Hover shows the beat's summary and its transcript snippet; a hidden list reads the beats to screen readers.
6. **Seeking:** clicking anywhere on the chart or strip seeks the embedded player to that second. Selecting a drop by click or by the left and right arrow keys (drops in time order) seeks to its start; from a stopped player, YouTube then plays. Below 640 px the chart and strip scroll sideways together inside one box.
7. **`<DropPanel>`,** opening on the video's largest drop:
   - a title such as "Why 41.9% of newcomers left at 0:03", the time range and the narrative;
   - "What the model links it to": a sentence built from the chips' own numbers ("The model links 13% of this drop to its position in the video and 3% to waiting for the payoff. It can't explain the other 84%."), the "Not a result yet" badge when the model is not usable, then the chips;
   - each cause chip shows its share and a "?" that opens a one-line note on what the cause means (a Popover, so it opens on a tap). "Unexplained" always shows, with its note;
   - every cause except position links to its effect on the audiences screen: `/app/audiences?audience=…&effect=…` opens that audience's sheet and highlights the effect.
8. **Performance:** scales and paths memoized; curves have 101 points and bands 202, under 600.
9. **Tests:**
   - a beat starting at 60 s and the curve's point at 60 s render at the same x; a snapshot of the chart for one fixture; keyboard navigation between drops;
   - the drop panel's sentence, links and notes; the audiences deep link;
   - the smoke test's second journey: video list, video, a note, a drop click read back from the real player, the arrow keys, a cause's link; at 390 and 1280 px.

## Decisions and gotchas

- Hand-rolled SVG instead of a chart library because the strip and curve must share one scale, bands and hover state. Libraries make this harder, not easier.
- On narrow screens, chart and strip scroll horizontally together inside one container. Its grid column must be allowed to shrink (`minmax(0, 1fr)`), or the chart's minimum width stretches the page.
- YouTube replaces the element it is given with its iframe, so the player gets a mount element React does not manage.
- The sentence in the drop panel is not Gemini's: Phase 11's narration never names causes while the models are not usable, so without it the panel never said why.

## Do not

- Hide the residual chip when it is large. A large unexplained share is information.

## Done when

- [x] The autopsy works for every video of a real channel
- [x] Clicking a drop seeks the player correctly
- [x] Fixtures mode matches the real API rendering
- [x] Usable at 390 px
- [x] `docs/notes/phase-13.md` written with screenshots
