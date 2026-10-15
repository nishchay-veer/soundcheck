# Design system

Read by Phases 12 to 17 and any session that touches the UI. Soundcheck uses a Gumroad-inspired neo-brutalist style: a cream page, thick black outlines, hard offset shadows with no blur, one hot pink for actions, flat bright fills, and big confident type. Take the style, not the brand: no Gumroad logo, wordmark, illustrations, copy or font files. There is one light theme; the style depends on cream and black.

## Tokens

Defined as CSS variables in `apps/web/src/app/globals.css` and exposed through Tailwind v4 `@theme`. No raw hex values anywhere else.

| Token               | Value                | Use                                                                                                                  |
| ------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `--bg`              | `#F4F4F0` cream      | Page background                                                                                                      |
| `--surface`         | `#FFFFFF`            | Cards, inputs, chart plot areas, tooltips                                                                            |
| `--ink`             | `#000000`            | Text, borders, shadows, axes                                                                                         |
| `--ink-muted`       | `#4A4A4A`            | Secondary text (about 8:1 contrast on cream)                                                                         |
| `--rule`            | `#D9D9D0`            | Chart gridlines only                                                                                                 |
| `--accent`          | `#FF90E8` pink       | Primary buttons, the selected item, key highlights; black text on it                                                 |
| `--highlight`       | `#FFC900` yellow     | Badges, "new" markers, the headline banner                                                                           |
| `--positive`        | `#00A86B`            | Positive deltas (arrow and chip border, never body text)                                                             |
| `--negative`        | `#E5482D`            | Negative deltas, drop windows                                                                                        |
| `--aud-subscribers` | `#8FD5C2` mint       | Subscriber audience everywhere                                                                                       |
| `--aud-newcomers`   | `#FF8A5B` orange     | Newcomer audience everywhere                                                                                         |
| `--aud-search`      | `#FFC900` yellow     | Estimated search audience                                                                                            |
| `--aud-suggested`   | `#B9A7FF` lavender   | Estimated suggested audience                                                                                         |
| `--aud-browse`      | `#C9C9C0` stone      | Estimated browse audience                                                                                            |
| `--beat-opening`    | `#7CC6FE` sky        | Beat blocks that open a video (cold open, hook, branded intro)                                                       |
| `--beat-promotion`  | `#EAD7B7` sand       | Beat blocks that promote (sponsor, self-promotion, call to action)                                                   |
| `--beat-closing`    | `#E2E2DA` light grey | Beat blocks that close (recap, outro, end screen); content beats are white, and tangents white with a dashed outline |

## Shape, depth and type

- **Borders:** 2px solid black on cards, buttons, inputs, chips, tooltips and beat blocks. 1px only for chart gridlines.
- **Radius:** 4px on cards, buttons and inputs; full pill on chips and badges.
- **Shadow:** hard offset `4px 4px 0 0 var(--ink)`, never blurred. Clickable cards and buttons gain it on hover while moving up-left by 4px; on press they return to rest with no shadow. Static cards have no shadow.
- **Never:** gradients, blur, glass effects, soft shadows, or white text on a pastel fill.
- **Type:** Space Grotesk (headings, weights 500 and 700, tight tracking; hero 64 to 80px, page title 40px, section 28px), Inter (body 16px, line height 1.5), JetBrains Mono (timestamps and IDs). All loaded with `next/font/google`. Numbers use `tabular-nums`. Sentence case everywhere.
- **Layout:** 8px grid, max content width 1200px, generous whitespace, a header bar with a 2px black bottom rule, sections separated by 2px black rules rather than background changes.
- **Motion:** only the hover lift (120 ms) and one reveal on the audiences screen; everything off under `prefers-reduced-motion`.
- **Focus:** a visible 2px black outline with a 2px pink offset ring on every interactive element.

## Components

shadcn/ui primitives are restyled to these rules, not replaced: Button (primary pink, secondary white, ghost underlined text), Card, Badge, Input, Tooltip, Popover (the tooltip's box, opened by a tap, for notes that must work on a phone), Sheet, Progress (a black-bordered bar with a pink fill), Skeleton (cream blocks with black borders, no shimmer).

## Charts in the same language

- The plot area is a white card with a 2px black border; axes are 2px black; gridlines 1px `--rule`, dashed.
- Actual retention curves are 3px lines in the audience color drawn over a 6px black underlay, so even yellow reads on white.
- The predicted median is a 2px dashed black line; the 10th to 90th percentile band is the audience color at 35% opacity with a black outline.
- Drop windows are `--negative` at 15% opacity with black diagonal hatching.
- Beat blocks are flat fills by group with 2px black borders and black labels inside; removed or trimmed beats in the edit view are hatched; moved beats get a black arrow.
- Effects on the audiences screen are plain words, not bars: grouped by what they say (keeps viewers, loses viewers, no clear effect yet, not in the videos yet), each clear one with a green or red arrow and chip border, what was tried, and how many of every 100 viewers stay to the end with a range.
