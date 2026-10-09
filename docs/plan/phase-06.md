# Phase 06 — Extraction quality gate

**Goal.** Prove that Gemini's beat extraction is consistent enough to train a model on, tune the prompt until it is, then extract every recruited channel's full catalogue. The quality report becomes one of your strongest slides.

**Depends on.** Phase 05. Day: Oct 5. The data gate falls at the end of this day.

## Stack

- `packages/core/src/stats/agreement.ts`: Cohen's kappa, quadratic-weighted kappa, boundary F1 with tolerance, and Spearman correlation, each unit-tested against published worked examples (quadratic-weighted kappa against its identity with Lin's concordance correlation)
- The Phase 05 extractor with the cache bypassed and not written, a seed per run, and a temperature option

## Build

1. `soundcheck consistency runs` (`apps/pipeline/src/commands/consistency/`): a fixed test set of 6 videos of varied length and format (`test-set.ts`: four public videos (a tutorial, vlog, review and explainer) and the test channel's two videos that are not few-shot examples). Extract each 3 times with the cache bypassed and not written, each run with its own seed at temperature 0. If every run is identical, also run 3 times at temperature 0.4 to measure sensitivity. Two calls at a time; a call that fails (an API or network error, not a bad answer) is run once more at the end.
2. Metrics, computed for every pair of runs and averaged:
   - Boundary F1: a boundary matches when another run has one within ±3 s.
   - Per-second label agreement for `beat_type` and `visual`: Cohen's kappa over the per-second label sequence, pooled across all six videos for each pair of runs (so a video with one label throughout cannot make kappa undefined).
   - Ordinal fields (`energy`, `assumed_knowledge`, `info_density`, `talking_head_share`): quadratic-weighted kappa per second, pooled the same way.
   - `payoff_time_s`: mean absolute difference in seconds.
3. Gate thresholds: boundary F1 at least 0.70; `beat_type` kappa at least 0.60; `visual` kappa at least 0.70 (it replaced `framing` in iteration 3); ordinal weighted kappa at least 0.50.
4. If a threshold fails: print the confusion matrix, then tighten definitions or merge confusable categories (for example, `context` into `setup`, or `demonstration` with `example`). Every enum or prompt change bumps `EXTRACTION_VERSION`. Re-run. Record each iteration in the notes.
5. Human agreement (`soundcheck consistency human`): one teammate labels `beat_type` for 2 videos in a CSV (start, end, type) in `docs/quality/human-labels/`. Compute Gemini-versus-human kappa with the same per-second method. This is the number that tells judges the labels mean something. With `--draft` the CSVs are pre-filled with Gemini's labels for the person to correct; the report then says so and counts the beats changed, because agreement measured that way is biased upward.
6. Write `docs/extraction-quality.md` and a row in `quality_reports` (`soundcheck consistency gate`, stage `extraction-quality-gate`): thresholds, achieved values, iterations, human agreement, cost per video minute. Every consistency and human report is kept as its own row too.
7. Once gated, run full extraction for every recruited channel. Record the total cost.

## Decisions and gotchas

- A collapsed category set that passes the gate is better than a rich one that doesn't. The model can only learn from distinctions Gemini makes reliably.
- Keep the 6 test videos fixed across iterations so numbers are comparable.
- One label for the picture could not describe beats that cut between a presenter and something else; `framing` became `talking_head_share` (1 to 5) and `visual`.
- Gate scores move by about ±0.1 between identical runs with 6 videos and 3 runs; read a single iteration's change with that in mind.

## Do not

- Train on features from an extraction version that has not passed the gate.

## Done when

- [ ] All gate thresholds met, or a documented decision to collapse categories with the passing numbers
- [ ] Human agreement reported
- [ ] Full extraction complete for every recruited channel, total cost recorded
- [ ] Data gate checked: 2 or more channels with 40 or more videos having curves and beats
- [ ] `docs/notes/phase-06.md` written
