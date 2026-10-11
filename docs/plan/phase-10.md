# Phase 10 — Pipeline orchestration

**Goal.** One call builds a channel end to end, unattended: connect to ready, with progress visible in Firestore, safe re-runs, and a clear failure state. Until now each stage ran from the CLI; this phase makes it a system.

**Depends on.** Phases 03 to 09. Day: Oct 10.

## Stack

- Cloud Workflows (YAML) with the Cloud Run Admin API v2 connector `googleapis.run.v2.projects.locations.jobs.run` (overrides for args, env and task count)
- Cloud Run Jobs from two images: the TypeScript pipeline image and the Python modeling image
- Firestore for progress; `@google-cloud/workflows` executions client in the web app
- Cloud Build and Artifact Registry; Cloud Scheduler for weekly refresh

## Build

1. **Jobs,** all with service account `sa-pipeline`, receiving `CHANNEL_ID`, `RUN_ID` and `BUILD_MODE` as env overrides. Each runs one stage: `soundcheck stage <name>` (TypeScript) or `soundcheck-modeling stage <name>` (Python).
   - `job-ingest`: catalogue, stats, mix, retention, then the eligible and usable video counts on `build`. 1 task, 1 h timeout.
   - `job-extract`: beats. Task count set per run, parallelism 10, 1 h task timeout, 2 retries.
   - `job-extract-load`: beats and extraction runs into BigQuery. 1 task.
   - `job-features`: training table. 1 task.
   - `job-train`: the channel's models, from the Python modeling image, against whatever pooled prior exists. 1 task, 4 GiB memory, 2 CPU.
   - `job-baseline` (TypeScript, the generic-LLM baseline curves), then `job-evaluate` (Python). The evaluate job writes no plots or model card in the cloud; regenerate the card locally. 1 task each.
   - `job-publish`: Firestore serving documents (Phase 11; a placeholder until then). 1 task.
   - The other jobs retry once. Every stage is idempotent (rule 7).
2. **`infra/workflows/channel_build.yaml`,** with argument `{channel_id, run_id, mode: "build" | "refresh", allow_small}`:
   - Init: set `channels/{id}.build` to `running` at stage `ingest` (`startChannelBuild` already set `queued`, the run ID, mode and start time).
   - Run ingest and wait. Read the usable-video count ingest wrote; below `MIN_TRAIN_VIDEOS` (a workflow env var), set `insufficient_data` and stop, unless `allow_small` (testing and demos; the models stay marked not usable).
   - Run extract with task count `min(10, ceil(eligible / 10))`.
   - Run extract-load, features, train, baseline, evaluate, publish.
   - Set state `ready`.
   - Each stage runs in `try`/`retry` (2 retries, exponential backoff from 30 s); on final failure, set `failed` with `stage`, a short error message (the job's own error when there is one) and `finishedAt`.
3. **A throttled progress writer** in `packages/core/src/jobs/progress.ts` (with a small equivalent in `services/modeling`) writes at most once per 5 s per job: `build.progress = {stage, done, total, etaS, updatedAt}`.
4. **Starting a build:** `startChannelBuild` in `packages/core/src/data/build.ts` marks the build `queued` in a Firestore transaction that refuses while another build is queued or running, then starts an execution. A build whose execution has ended without recording it, or that was queued over 5 minutes ago with no execution, is stale and may be replaced. If the workflow cannot start, the build is `failed` at stage `start`. Callers:
   - `POST /api/v1/channels/[id]/build`: 202 with the run; 401 without a session; 404 for a channel the user does not own; 409 while a build runs; 503 when builds are not configured;
   - connectChannel (Phase 02), on a channel's first connection;
   - `soundcheck build start --channel UC… [--mode refresh] [--allow-small]`.
5. **Deployment,** from your terminal:
   - `infra/09-orchestration.sh`: the Cloud Scheduler API, IAM for Workflows and Cloud Build (including read access to `gs://{project}_cloudbuild`), and the scheduler job.
   - `infra/deploy-pipeline.sh [--no-build]`: `gcloud builds submit` for the pipeline and modeling images, then `gcloud run jobs deploy` for each job, with env from `.env`'s non-secret keys and the OAuth client from Secret Manager.
   - `infra/deploy-workflows.sh`: both workflows with `sa-workflows`; then set `WORKFLOW_CHANNEL_BUILD=channel_build` in `.env`.
6. **Weekly refresh:** a Cloud Scheduler job (Mondays 03:00 IST) starts `weekly_refresh`, which refits the pooled models once, then starts `channel_build` with `mode=refresh` for each ready channel. A refresh re-reads the catalogue (new videos get beats; extracted ones are cached), re-fetches stats and retention for videos published in the last 60 days, skips the mix, and re-runs the later stages. It runs without `allow_small`.
7. **Resilience test:** kill a run during extract, start it again, confirm it completes with no duplicate rows and cached extractions reused.

## Decisions and gotchas

- Workflows over Pub/Sub chaining: the build is a DAG with waits and branches, and Workflows gives retries and an execution history without custom queue code.
- Job overrides require `run.jobs.runWithOverrides`, which `roles/run.developer` includes.
- Workflows YAML: `env` is a reserved name; a subworkflow parameter's default must be a literal; expressions cannot hold map literals; an expression containing `": "` must be quoted.
- A failed job reaches the workflow as "An error occurred during execution of a long-running operation"; the useful text is in `operation.error.message`.
- Code in the images must not assume the repo's layout: the modeling package sits at `/app/src` with no repo around it.
- Starting a container takes 1.5 to 3 minutes per job, so a build of a 3-video channel takes about 22 minutes for under 3 minutes of work.
- A key bound twice in one pino logger garbles in Cloud Logging; the stage runner binds `build_run_id` and `build_stage`.

## Do not

- Run any stage inside an API request handler.

## Done when

- [x] From the web Connect button to `build.state == "ready"` runs unattended on a real channel
- [x] A forced failure in one stage marks `failed` with the stage and message
- [x] The kill-and-rerun test passes
- [x] Timing per stage recorded in the notes
- [x] `docs/notes/phase-10.md` written
