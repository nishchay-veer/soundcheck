# Phase 12 — Onboarding and audiences screen

**Goal.** The first two experiences: connect and watch the build progress, then the audience reveal, the moment a creator realizes this is not YouTube Studio. Built against fixtures, wired to the real API at the end.

**Depends on.** Phase 11 contracts (fixtures are enough to start). Also read docs/plan/design-system.md. Day: Oct 12; can start Oct 6 in parallel.

## Stack

- Next.js 16 App Router; React Server Components call packages/core data functions directly
- SWR for client polling; Tailwind v4; shadcn/ui (Card, Badge, Progress, Tooltip, Skeleton, Sheet)
- `lucide-react` icons; `next/font` with Space Grotesk, Inter and JetBrains Mono; Framer Motion for one or two restrained reveals
- Custom SVG for effect bars; zod schemas from packages/core
- Vitest and Testing Library; Playwright for one smoke test

## Design direction

This phase implements docs/plan/design-system.md, before any screen. First: the tokens in `globals.css` with Tailwind v4 `@theme`, the three fonts through `next/font/google`, and the shadcn/ui primitives restyled to the spec. Then a `/styleguide` route showing every component in every state, all audience colors, a sample retention chart and a sample beat strip, so the look is reviewed once and every later screen reuses it. Each audience keeps its fixed color on every screen, so a color always means the same people. Every number with an interval shows the interval. Estimated audiences carry an "estimated" badge with a tooltip explaining how. Accessible (WCAG AA contrast, keyboard navigation, visible focus) and usable at 390 px.

## Build

1. **Design system first:**
   - the tokens in `globals.css` (plus `--beat-opening` and `--beat-promotion` for beat blocks), the three fonts through `next/font/google`;
   - shadcn/Radix primitives restyled in `packages/ui`: Button, Card, Badge, Progress, Tooltip, Skeleton, Sheet;
   - `/styleguide`, with every component in every state, the audience and beat colors, a sample retention chart and a sample beat strip.
2. **`/`:**
   - the line "Run a soundcheck before you publish", with Connect YouTube (or Open your channel when signed in);
   - what Soundcheck reads and how to delete it, in plain words.
   - The Explore demo button stays hidden until Phase 17 wires it.
3. **`/app`** redirects by state: `ready` to `/app/audiences`; every other build state (not started, queued, running, failed, `insufficient_data`) to `/app/building`; a channel whose access was revoked to `/reauth`.
4. **`/app/building`:**
   - five steps:
     - collecting your videos and how each audience watched (ingest);
     - watching your videos, n of N (extract and its load);
     - learning your audiences (features, train);
     - checking our accuracy (baseline, evaluate);
     - publishing your screens.
   - SWR polls `GET /api/v1/channels/{id}` every 3 s while queued or running, then stops. The current step shows its job's progress and time left.
   - The states:
     - not started (Start);
     - running ("you can close the tab");
     - failed (the step, the technical detail, Try again);
     - `insufficient_data` (the minimum, the channel's usable and eligible videos, the eligibility rule, Check again, and See the preview anyway when a summary exists);
     - ready.
5. **`/app/audiences`,** the home screen once built, or a preview when the channel has too few videos:
   - a "Not a result yet" note while the models are not usable, and a preview line when the build is not ready;
   - the metric row: videos analysed, audiences found, beats extracted, and the model error against the channel average ("Not measured" until a held-out evaluation exists), each with a tooltip where it needs one;
   - the headline banner;
   - the audience cards: label, kind badge, view share, watch-time share, average view percentage, the top 3 clear traits with intervals, and the description. Clicking a card opens its Sheet: every simulated effect as an `<EffectBar>` on one scale centered on zero, clear ones first by size.
   - The cards reveal once in turn (none under reduced motion).
6. **Navigation:** Audiences, then Videos, Soundcheck and Model marked "Soon"; Channel settings (`/app/settings`, with disconnect); a channel switcher only for users with more than one channel.
7. **Components** in `src/components/`: `StatCard`, `AudienceCard`, `AudienceGrid`, `EffectBar`, `KindBadge`, `InfoTip`, `IntervalText` (formats `+4.2 pp (2.1 to 6.3)`), `BuildProgress`, `BuildScreen`, `ResultNotice`, `RetentionChart`, `BeatStrip`, `AppNav`.
8. **No new route handlers:** Phase 11's routes serve the client components, and the server components call the same data functions.
9. **Every route under `/app`** has a loading skeleton and an error boundary (`retry()`), plus an empty state where data can be missing.
10. **Tests:**
    - component tests in jsdom with Testing Library;
    - a Playwright smoke test in fixtures mode at 390 and 1280 px (`pnpm --filter @soundcheck/web test:e2e`, installed Chrome, not part of `pnpm check`).

## Do not

- Show a number with more precision than its interval supports. One decimal for percentage points.
- Use the word "cohort" anywhere a user can see it.

## Done when

- [x] Full flow works on the deployed web app against the real API
- [x] Fixtures mode works offline
- [x] Lighthouse accessibility score 90 or above
- [x] Checked at 390 px wide
- [x] `docs/notes/phase-12.md` written with screenshots
