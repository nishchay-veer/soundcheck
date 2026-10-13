# Phase 14 — Soundcheck upload and prediction

**Goal.** A creator submits a rough cut file, an unlisted YouTube link, or a script, and within minutes sees predicted retention per audience with uncertainty bands, with live progress while it runs.

**Depends on.** Phases 05, 07, 08, 10 and 13. Also read docs/plan/design-system.md. Day: Oct 14.

## Stack

- Cloud Storage V4 signed URLs for resumable uploads, signed by `sa-web` through IAM `signBlob`
- Eventarc (object finalized on the uploads bucket) to the `soundcheck` workflow
- Cloud Run Job `job-soundcheck`; `ffprobe` in the pipeline image
- `@google/genai` with `gs://` URIs, YouTube URLs or text
- Shared featurizer and model runtime from `packages/core`; Firestore `soundchecks/{id}`
- Optional, display only: Video Intelligence shot detection for uploaded files

## Build

1. `/app/soundcheck/new` with three input modes:
   - **File:** drag and drop mp4, mov or webm, up to 4 GB and 60 minutes.
   - **YouTube link:** public or unlisted only; private fails with a clear message.
   - **Script:** paste text or upload `.txt` or `.md`.
   - Optional fields: working title, and Expected traffic (Like my recent videos, Mostly search, Mostly suggested, Mostly subscribers), which sets the audience-mix scenario.
2. `POST /api/v1/soundchecks {kind, title, scenario}` creates the document with `status: "awaiting_upload"` and, for files, returns a resumable session URL for `gs://{project}-uploads/{channel}/{id}/source.{ext}`. The browser uploads in 8 MB chunks with a progress bar. For links and scripts, the API starts the workflow directly.
3. Eventarc trigger on the uploads bucket (finalized events, path filter by prefix) runs `infra/workflows/soundcheck.yaml`, which runs `job-soundcheck` with `SOUNDCHECK_ID`.
4. `job-soundcheck` steps, each updating `progress` with a plain-language step: probe duration with `ffprobe` (files); extract beats with the Phase 05 extractor and validator; build bins with the Phase 07 featurizer, using the scenario's traffic mix; predict with each audience model via `sample_curves`; compute `percentile_vs_channel` by comparing the median predicted average view percentage with the channel's recent videos; run the edit search (Phase 15; skip until then); narrate; write the result.
5. Script mode uses a separate prompt, `packages/core/src/prompts/plan-from-script.md`: Gemini segments the script into planned beats with `beat_type`, `assumed_knowledge`, `info_density` and loops; each beat's duration = its word count divided by the creator's median speech rate from their own catalogue; visual features are filled from the channel's medians for that beat type and flagged `visual_assumed: true`. Widen the bands by adding variance for assumed features, and tell the user.
6. `/app/soundcheck/[id]`: live progress (SWR polling every 2 s) with step text such as "Found 23 beats"; then the result view reusing `<RetentionChart>` and `<BeatStrip>` in predicted mode (no actual line), per-audience predicted average view duration and percentage with ranges, and the line "Better than 68% of your recent videos" style comparison.
7. Safety and limits: size and MIME checks before signing; a 15-minute expiry on signed URLs; uploads auto-delete after 30 days (bucket lifecycle); copy on the page stating uploads are used only for this analysis.

## Decisions and gotchas

- Uploaded files could be analyzed with Video Intelligence for precise cut markers, but those markers are display-only. The model sees exactly the same Gemini features it was trained on.
- Scenario choice matters most for newcomers; show it next to the prediction so the creator remembers what they assumed.

## Do not

- Block the request thread on extraction. Everything after upload runs in the job.

## Done when

- [ ] All three input kinds produce results on the deployed stack
- [ ] A 10-minute rough cut completes in under 6 minutes end to end
- [ ] Progress text visible throughout
- [ ] Failure states handled: private link, oversized file, validation failure after retry
- [ ] `docs/notes/phase-14.md` written
