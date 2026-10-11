# Phase 12 — Onboarding and audiences screen

**Goal.** The first two experiences: connect and watch the build progress, then the audience reveal, the moment a creator realizes this is not YouTube Studio. Built against fixtures, wired to the real API at the end.

**Depends on.** Phase 11 contracts (fixtures are enough to start). Also read docs/plan/design-system.md. Day: Oct 12; can start Oct 6 in parallel.

## Stack

- Next.js 15 App Router; React Server Components call packages/core data functions directly
- SWR for client polling; Tailwind v4; shadcn/ui (Card, Badge, Progress, Tooltip, Skeleton, Sheet)
- `lucide-react` icons; `next/font` with Space Grotesk, Inter and JetBrains Mono; Framer Motion for one or two restrained reveals
- Custom SVG for effect bars; zod schemas from packages/core
- Vitest and Testing Library; Playwright for one smoke test

## Design direction

This phase implements docs/plan/design-system.md, before any screen. First: the tokens in `globals.css` with Tailwind v4 `@theme`, the three fonts through `next/font/google`, and the shadcn/ui primitives restyled to the spec. Then a `/styleguide` route showing every component in every state, all audience colors, a sample retention chart and a sample beat strip, so the look is reviewed once and every later screen reuses it. Each audience keeps its fixed color on every screen, so a color always means the same people. Every number with an interval shows the interval. Estimated audiences carry an "estimated" badge with a tooltip explaining how. Accessible (WCAG AA contrast, keyboard navigation, visible focus) and usable at 390 px.

## Build

1. `/`: one-line value proposition ("Run a soundcheck before you publish"), a Connect YouTube button, and an Explore demo channel button (wired in Phase 17). A short honest note on what data is read and how to delete it.
2. `/app`: redirects by build state: `not_started` or `running` to `/app/building`; `ready` to `/app/audiences`; `reauth_required` to `/reauth`.
3. `/app/building`: a stage list (Collecting your videos; Measuring how each audience watched; Watching your videos, n of N; Learning your audiences; Checking our accuracy; Ready). SWR polls `GET /v1/channels/{id}` every 3 s. Expectation copy: this takes a while for large channels; you can close the tab. States for `failed` (stage and a retry button), `insufficient_data` (what is needed and why) and `reauth_required`.
4. `/app/audiences`, the home screen once ready:
   - Metric row: videos analysed, audiences found, beats extracted, and model error against the channel average with a tooltip explaining the comparison.
   - Headline banner from `summary.headline`.
   - Audience cards: label, kind badge, view share, watch-time share, average view percentage, top 3 traits each with delta and interval, and the description.
   - Clicking a card opens a Sheet listing all traits as `<EffectBar>` rows: a horizontal bar for the delta and whiskers for the interval, centered on zero, sorted by size.
5. Navigation: Audiences, Videos, Soundcheck, Model. A channel switcher only if the user has more than one channel.
6. Components in `src/components/`: `StatCard`, `AudienceCard`, `EffectBar`, `KindBadge`, `BuildProgress`, `IntervalText` (formats `+4.2 pp (2.1 to 6.3)`).
7. Route handlers under `src/app/api/` wrap the same data functions for client components (there is no `separate API service)`, validate with zod, and return typed JSON. Server components call the same functions directly.
8. Loading skeletons, empty states and an error boundary per route.

## Do not

- Show a number with more precision than its interval supports. One decimal for percentage points.
- Use the word "cohort" anywhere a user can see it.

## Done when

- [ ] Full flow works on the deployed web app against the real API
- [ ] Fixtures mode works offline
- [ ] Lighthouse accessibility score 90 or above
- [ ] Checked at 390 px wide
- [ ] `docs/notes/phase-12.md` written with screenshots
