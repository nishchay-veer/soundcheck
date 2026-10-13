# Phase 14 — Soundcheck upload and prediction

**Goal.** A creator submits a rough cut file or a public or unlisted YouTube link, and within minutes sees predicted retention per audience with uncertainty bands, with live progress while it runs. (Script mode is left out for now, by Nishchay's decision.)

**Depends on.** Phases 05, 07, 08, 10 and 13. Also read docs/plan/design-system.md. Day: Oct 14.

## Stack

- Cloud Storage resumable uploads, each session opened by the server (`sa-web`) for one object of a fixed type and size
- Eventarc (object finalized on the uploads bucket) to the `soundcheck` workflow
- Cloud Run Job `job-soundcheck`; `ffprobe` in the pipeline image
- `@google/genai` with `gs://` URIs or YouTube URLs
- Shared featurizer and model runtime from `packages/core`; Firestore `channels/{id}/soundchecks/{id}`

## Build

1. **Probe first:** `scripts/probe-soundcheck-inputs.ts` checks that Gemini watches public and unlisted links and files in the uploads bucket, and refuses private links. Gemini reads Cloud Storage files up to 2 GB.
2. `/app/soundcheck/new` with two input modes:
   - **File:** drag and drop mp4, mov or webm, up to 2 GB and 1 to 60 minutes, uploaded in 8 MB chunks with a progress bar and Cancel; a dropped chunk resumes from what the session kept.
   - **YouTube link:** public or unlisted; a private one fails with "set it to Unlisted, or upload the file".
   - Optional fields: working title, and Expected traffic (Like my recent videos, Mostly search, Mostly suggested, Mostly subscribers), which sets the audience mix: the recent mix and subscriber share over the newest 20 videos, or at least 70% for the named source or audience.
   - The page says uploads are used only for this soundcheck and deleted after 30 days (bucket lifecycle).
3. `POST /api/v1/channels/[id]/soundchecks {kind, title, scenario, …}` checks the type, size and link, creates the document (`awaiting_upload` for a file, `queued` for a link) and, for a file, returns a resumable session for `gs://{project}-uploads/{channel}/{id}/source.{ext}`; for a link it starts the workflow directly. `GET …/soundchecks/[soundcheckId]` returns it, never cached.
4. The Eventarc trigger `soundcheck-upload` runs `infra/workflows/soundcheck.yaml` on every finished object; the workflow ignores objects that are not a soundcheck's upload and runs `job-soundcheck` with `CHANNEL_ID` and `SOUNDCHECK_ID`. If the job itself fails, a soundcheck left "running" is marked failed.
5. `job-soundcheck` claims the soundcheck in a transaction (a duplicate event cannot start a second run; a run silent for 20 minutes can be replaced), then, writing a plain progress message at each step:
   - **checking:** the length (`ffprobe` over HTTPS with the token in a header, for a file; `videos.list` with the channel's credentials, for a link, which also refuses a private video);
   - **watching:** the Phase 05 extractor and validator, uncached, its raw answers archived in the uploads bucket;
   - **predicting:** each audience's latest model and calibration, under the scenario's mix, 200 seeded draws (`predictCut`): bands, average view duration and percentage as ranges, both audiences weighted, and where the median falls among the newest 20 videos' YouTube average view percentage;
   - **finishing:** a summary sentence from the numbers, the result, and `inputs/current` (the cut as the model reads it, for Phase 15).

   Every failure ends as `failed` with a code and a message the creator can act on.

6. `/app/soundcheck` lists the channel's soundchecks. `/app/soundcheck/[id]` shows the steps with the job's message (SWR polling every 2 s), then the result: average view and percentage of the cut with ranges, "better than N% of your recent videos", each audience's numbers, the summary sentence, "Not a result yet" while the model is not usable, the scenario, and `<AutopsyChart>` and `<BeatStrip>` in predicted mode (no actual line), with the player beside them for a link. A failure shows its message and New soundcheck.
7. Safety and limits: type, size and link checks before any upload; upload sessions fixed to one new object; uploads and Gemini's answers deleted after 30 days; soundchecks deleted with the channel.

## Decisions and gotchas

- Uploaded files could be analyzed with Video Intelligence for precise cut markers, but those markers are display-only. The model sees exactly the same Gemini features it was trained on. Not built.
- Scenario choice matters most for newcomers; show it next to the prediction so the creator remembers what they assumed.
- Eventarc cannot filter Cloud Storage events by prefix; the workflow does.
- The logger redacts any key ending in "token(s)": log counts as `…_token_count`.

## Do not

- Block the request thread on extraction. Everything after upload runs in the job.

## Done when

- [ ] File and link produce results on the deployed stack: file done; **to do:** a ready unlisted link
- [ ] A 10-minute rough cut completes in under 6 minutes end to end: **to do**
- [x] Progress text visible throughout
- [x] Failure states handled: private link, oversized file, validation failure after retry
- [x] `docs/notes/phase-14.md` written
