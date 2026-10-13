# Phase 15 — Edit list and counterfactuals

**Goal.** Turn a prediction into decisions: a ranked list of simulated edits, each with an effect size and interval, that the creator can toggle to watch the predicted curve change instantly, then export as a cut list and chapters.

**Depends on.** Phase 14. Also read docs/plan/design-system.md. Day: Oct 15.

## Stack

- `Float64Array` matrix math in `packages/core/src/model`, vectorized over coefficient samples; `ml-matrix` for the Cholesky factor; the seeded PRNG from Phase 08
- A Next.js route handler on the Node runtime with a module-level `lru-cache` of model artifacts per channel (Cloud Run instances are long-lived; keep min instances at 1)
- React; SWR mutation with a 250 ms debounce
- `@google/genai` flash model for chapter titles and rationale polish at job time only

## Build

1. `packages/core/src/model/counterfactual.ts` represents a cut as a list of beats in seconds. Edit operations:
   - `remove(i)`: drop beat i.
   - `trim(i, keep=0.5)`: cut the second half of beat i; scale its transcript word count proportionally.
   - `move(i, to=j)`: only for movable types (sponsor, self\_promo, cta, payoff, recap, intro\_branding). Candidate targets: sponsor and self\_promo to the first boundary after 40% or 60% elapsed; payoff to before 25% or 40%; intro\_branding to just after the hook; cta to the end.
   - After applying operations, re-time beats contiguously, rebuild bins with the same featurizer, and predict.
2. Objective, chosen by a UI toggle: average view duration in seconds (default, because cutting content trivially raises percentage viewed) or average percentage viewed. Combine audiences weighted by the scenario's expected view shares.
3. Uncertainty with common random numbers: draw 200 coefficient samples once per request and evaluate the baseline and every candidate with the same samples. The difference distribution is then tight and honest. Report 10th, 50th and 90th percentiles.
4. Search: evaluate all single edits (about 3 per beat), vectorized as bins matrix times sample matrix. Greedily take the best edit whose median gain is positive and whose 10th percentile is above minus 0.5 points, apply it, repeat up to 5 edits. Also return the top 8 single edits. Target under 300 ms for 30 beats.
5. Rationale: a template per operation filled from the dominant feature change ("No visual change for 51 seconds"). Gemini polishes the initial list during the job; interactive re-ranking uses templates only, so there is no LLM on the hot path.
6. `POST /api/v1/soundchecks/[id]/simulate {edits, objective}` returns per-audience curves (p10, p50, p90), totals and deltas, computed in-process.
7. `job-soundcheck` now writes the initial recommended `edits` to Firestore.
8. UI on `/app/soundcheck/[id]`: a side panel listing edits with timestamp, label, rationale and delta with range; green when the interval is above zero, gray when it crosses zero; checkboxes to apply. The curve animates to the new prediction. On the beat strip, removed or trimmed segments are hatched and moved ones show an arrow. Header: "Predicted AVD 6:12 to 7:48 (7:20 to 8:10)".
9. Exports: CSV cut list (start, end, action, note); YouTube chapters for the post-edit cut (first chapter at 0:00, at least 3 chapters, each at least 10 s, titles of 5 words or fewer from Gemini at job time); copy to clipboard. Stretch: CMX3600 EDL.
10. Tests: on a synthetic model, removing a beat with a strongly negative coefficient raises predicted retention; re-timing after removal shortens duration by exactly the beat length; the same edit set returns identical results across calls (seeded samples); endpoint latency under the target.

## Do not

- Present an edit whose interval crosses zero as a recommendation. Show it, gray, as uncertain.
- Call Gemini from the simulate endpoint.

## Done when

- [ ] Recommendations appear for real rough cuts
- [ ] Toggling edits updates the curve in under 400 ms round trip
- [ ] CSV and chapter exports work
- [ ] At least one demo cut where the recommended edits are intuitively sensible, recorded in the notes
- [ ] `docs/notes/phase-15.md` written
