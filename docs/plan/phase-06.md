# Phase 06 — Extraction quality gate

**Goal.** Prove that Gemini's beat extraction is consistent enough to train a model on, tune the prompt until it is, then extract every recruited channel's full catalogue. The quality report becomes one of your strongest slides.

**Depends on.** Phase 05. Day: Oct 5. The data gate falls at the end of this day.

## Stack

- `packages/core/src/stats/agreement.ts`: Cohen's kappa, quadratic-weighted kappa, boundary F1 with tolerance, and Spearman correlation, each unit-tested against published worked examples
- The Phase 05 extractor with `--no-cache`

## Build

1. `apps/pipeline/src/commands/consistency.ts`: choose 6 videos of varied length and format. Extract each 3 times with the cache bypassed. If temperature 0 returns identical output every time, also run 3 times at temperature 0.4 to measure sensitivity.
2. Metrics, computed for every pair of runs and averaged:
   - Boundary F1: a boundary matches when another run has one within ±3 s.
   - Per-second label agreement for `beat_type` and `framing`: Cohen's kappa over the per-second label sequence.
   - Ordinal fields (`energy`, `assumed_knowledge`, `info_density`): quadratic-weighted kappa per second.
   - `payoff_time_s`: mean absolute difference in seconds.
3. Gate thresholds: boundary F1 at least 0.70; `beat_type` kappa at least 0.60; `framing` kappa at least 0.70; ordinal weighted kappa at least 0.50.
4. If a threshold fails: print the confusion matrix, then tighten definitions or merge confusable categories (for example, `context` into `setup`, or `demonstration` with `example`). Every enum or prompt change bumps `EXTRACTION_VERSION`. Re-run. Record each iteration in the notes.
5. Human agreement: one teammate labels `beat_type` for 2 videos by hand in a CSV (start, end, type). Compute Gemini-versus-human kappa with the same per-second method. This is the number that tells judges the labels mean something.
6. Write `docs/extraction-quality.md` and a row in `quality_reports`: thresholds, achieved values, iterations, human agreement, cost per video minute.
7. Once gated, run full extraction for every recruited channel. Record the total cost.

## Decisions and gotchas

- A collapsed category set that passes the gate is better than a rich one that doesn't. The model can only learn from distinctions Gemini makes reliably.
- Keep the 6 test videos fixed across iterations so numbers are comparable.

## Do not

- Train on features from an extraction version that has not passed the gate.

## Done when

- [ ] All gate thresholds met, or a documented decision to collapse categories with the passing numbers
- [ ] Human agreement reported
- [ ] Full extraction complete for every recruited channel, total cost recorded
- [ ] Data gate checked: 2 or more channels with 40 or more videos having curves and beats
- [ ] `docs/notes/phase-06.md` written
