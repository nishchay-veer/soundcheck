# Phase 10 — Pipeline orchestration

**Goal.** One call builds a channel end to end, unattended: connect to ready, with progress visible in Firestore, safe re-runs, and a clear failure state. Until now each stage ran from the CLI; this phase makes it a system.

**Depends on.** Phases 03 to 09. Day: Oct 10.

## Stack

- Cloud Workflows (YAML) with the Cloud Run Admin API v2 connector `googleapis.run.v2.projects.locations.jobs.run` (overrides for args, env and task count)
- Cloud Run Jobs from two images: the TypeScript pipeline image and the Python modeling image
- Firestore for progress; `@google-cloud/workflows` executions client in the web app
- Cloud Build and Artifact Registry; Cloud Scheduler for weekly refresh

## Build

1. Jobs, all with service account `sa-pipeline`, receiving `CHANNEL_ID` and `RUN_ID` as env overrides:
   - `job-ingest`: catalogue, mix, retention. 1 task, 1 h timeout.
   - `job-extract`: beats. Task count set per run, parallelism 10, 1 h task timeout, 2 retries.
   - `job-features`: training table. 1 task.
   - `job-train`: models, from the Python modeling image. 1 task, 4 GiB memory, 2 CPU.
   - `job-evaluate`: evaluation and model card, from the Python modeling image, preceded by job-baseline (TypeScript, the generic-LLM baseline curves). 1 task each.
   - `job-publish`: Firestore serving documents (Phase 11). 1 task.
2. `infra/workflows/channel_build.yaml`:
   - Init: set `channels/{id}.build` to `{state: "running", run_id, stage: "ingest", started_at}`.
   - Run ingest and wait. Read the coverage count written by ingest; if usable videos are below `MIN_TRAIN_VIDEOS`, set state `insufficient_data` and stop.
   - Run extract with task count `min(10, ceil(n / 10))`.
   - Run features, train (if no pooled prior exists, train with prior zero), evaluate, publish.
   - Set state `ready`.
   - Wrap each step in `try`/`retry` with an exponential policy; on final failure set state `failed` with `stage` and a short error message.
3. A throttled progress writer in `packages/core (with a 20-line equivalent in services/modeling)` (at most one Firestore write per 5 s per job) updates `build.progress = {stage, done, total, eta_s}`.
4. API `POST /api/v1/channels/[id]/build` starts an execution with argument `{channel_id, run_id}`. A Firestore transaction on `build.state` prevents two concurrent builds. connectChannel (Phase 02) calls the same startChannelBuild function directly.
5. `infra/deploy-pipeline.sh`: `gcloud builds submit` for the pipeline and modeling images, then `gcloud run jobs deploy` for each job with env from Secret Manager references. `infra/deploy-workflows.sh` deploys the YAML with `sa-workflows`.
6. Weekly refresh: a Cloud Scheduler job (Mondays 03:00 IST) starts the workflow with `mode=refresh` for each ready channel, which re-ingests stats and retention for videos published in the last 60 days, then re-runs features, train, evaluate and publish.
7. Resilience test: kill a run during extract, start it again, confirm it completes with no duplicate rows and cached extractions reused.

## Decisions and gotchas

- Workflows over Pub/Sub chaining: the build is a DAG with waits and branches, and Workflows gives retries and an execution history without custom queue code.
- Job overrides require `run.jobs.runWithOverrides`, which `roles/run.developer` includes.

## Do not

- Run any stage inside an API request handler.

## Done when

- [ ] From the web Connect button to `build.state == "ready"` runs unattended on a real channel
- [ ] A forced failure in one stage marks `failed` with the stage and message
- [ ] The kill-and-rerun test passes
- [ ] Timing per stage recorded in the notes
- [ ] `docs/notes/phase-10.md` written
