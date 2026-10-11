# Phase 10: Pipeline orchestration

Oct 10, 2026

One call now builds a channel end to end on Google Cloud, unattended:

- `startChannelBuild` (from Connect, the API or `soundcheck build start`) queues the build and starts the `channel_build` workflow;
- the workflow runs eight Cloud Run jobs in order (ingest, extract, extract-load, features, train, baseline, evaluate, publish), retrying each stage before giving up;
- progress, counts, the stage and any error live on `channels/{id}.build`;
- a channel with too few usable videos stops as `insufficient_data`;
- every Monday at 03:00 IST, Cloud Scheduler refreshes the ready channels.

On the test channel, a full build ran to `ready` in 22.6 minutes. A real failure ended as `failed` with the stage and a message. A build killed during extract was restarted and finished with no duplicate rows.

**Built in five reviewed commits:**

1. `Add TypeScript pipeline stages for unattended jobs`
2. `Add Python pipeline stages with build progress`
3. `Start channel builds through Workflows`
4. `Orchestrate the channel build in Cloud Workflows`
5. `Verify Phase 10 and write the notes`

## Done when

| Item                                                                                      | Status                     | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| From the web Connect button to `build.state == "ready"` runs unattended on a real channel | Done, started from the CLI | Build `d81fba4c`: 8 stages, unattended, `ready` in 22.6 minutes. It was started by `soundcheck build start --allow-small`, which calls the same `startChannelBuild` as Connect. The channel was already connected, and Connect starts a build only on the first connection; that path is covered by `channels.test.ts`. Without `allow_small`, the 3-video channel correctly stops: build `9e746d00`, `insufficient_data` after 4.6 minutes                                                                                                                                                                                                                                                                                                |
| A forced failure in one stage marks `failed` with the stage and message                   | Done, on a real failure    | Build `2c20a41e`: the train job crashed on startup (see Incidents). The workflow tried it 3 times, then wrote `failed`, stage `train`, the error and `finishedAt`; the execution ended `FAILED`. The message was the connector's generic one; it now carries the job's own error                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| The kill-and-rerun test passes                                                            | Done, with a caveat        | Build `43eaac35` was cancelled at 16:31:47 while the workflow waited on extract, and stayed marked `running` at stage `extract`. Starting again replaced it as stale (`replaced_stale: true`), and build `618c9c82` reached `ready` at 16:56:51. Afterwards every table a build replaces had one row per key (`training_bins` 900, `retention_curves` 900, `beats` 23, `retention_coverage` 12, `beat_videos` 4, `videos` 4, `feature_contexts` 1), and both extract runs reported "3 cached". **Caveat:** the extract job finished 5 s after the workflow was cancelled, before its own cancel landed, so this killed the orchestration rather than a job mid-write. With every video cached, extract had nothing partial to leave behind |
| Timing per stage recorded in the notes                                                    | Done                       | See "Timings"                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `docs/notes/phase-10.md` written                                                          | Done                       | This file                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

**Also verified:**

- **Deployment:** `infra/09-orchestration.sh`, `deploy-pipeline.sh` and `deploy-workflows.sh` ran from your terminal: 8 jobs on the two images, both workflows, and the scheduler job `weekly-refresh`.
- **A smoke test:** `job-publish` run alone exited 0 in 2 minutes 50 seconds, about 2.5 minutes of it starting the container.
- **`pnpm check`** passes all 20 tasks.

## Live run

All on Oct 10, 2026 (UTC), for the channel `UC-BHlgFbFh3V76yth-XCmlw` (3 usable videos, beats and Gemini baseline curves already cached).

| Started  | Build      | How                                   | Outcome                                                                                                   |
| -------- | ---------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 15:25:35 | `9e746d00` | `build start`                         | `insufficient_data` after 274 s: ingest ran with the live YouTube APIs, then "3 usable videos, 30 needed" |
| 15:30:45 | `2c20a41e` | `build start --allow-small`           | Ingest to features passed; train crashed 3 times; `failed` at 15:57:06                                    |
| 15:59:08 | `d81fba4c` | the same, on the fixed modeling image | `ready` at 16:21:45, the workflow's result "ready: 3 usable videos"                                       |
| 16:25:38 | `43eaac35` | the same                              | Cancelled at 16:31:47, during extract                                                                     |
| 16:32:36 | `618c9c82` | the same, replacing the stale build   | `ready` at 16:56:51 (24 minutes); no duplicate rows; extract "3 cached"                                   |

## Timings

Build `d81fba4c`, per stage. "Total" runs from the job's creation to its end. "Work" runs from its first to its last log line, so the difference is mostly Cloud Run starting the container.

| Stage        | Total    | Work    | Notes                                          |
| ------------ | -------- | ------- | ---------------------------------------------- |
| ingest       | 124 s    | 25 s    | catalogue, stats, mix, retention, counts       |
| extract      | 117 s    | 31 s    | 1 task; 3 videos cached, $0 Gemini             |
| extract-load | 193 s    | 29 s    | 4 videos, 23 beats reloaded                    |
| features     | 132 s    | 9 s     | 900 rows from 3 videos, unchanged              |
| train        | 215 s    | 22 s    | 3 audiences, each "fitted, not usable"         |
| baseline     | 163 s    | 19 s    | 3 curves, cached                               |
| evaluate     | 99 s     | 16 s    | check mode; no plots or card in the cloud      |
| publish      | 167 s    | 6 s     | a placeholder until Phase 11                   |
| **All**      | 22.6 min | 2.6 min | the workflow's own steps add about 2.5 minutes |

**Starting containers takes three quarters of the time** (17.5 of 22.6 minutes). Each job takes 1.5 to 3 minutes before its first log line, whatever it does, so a 3-video channel takes 22 minutes for under 3 minutes of work. A 40-video channel adds real work to extract (new beats), features and train, and the overhead stays the same.

## Decisions

By Nishchay: the plan with seven fixes, and one dependency.

1. **`allow_small`,** for testing and demos: the build runs every stage below `MIN_TRAIN_VIDEOS`, and the models stay marked not usable.
2. **`soundcheck build start --channel`** stands in for Connect on an already connected channel; it calls the same function.
3. **The train job fits the channel's own models** against whatever pooled prior exists. The pooled models are refitted once per weekly refresh, before the channels.
4. **The weekly refresh also re-reads the catalogue,** so new videos get beats; extracted ones come from the cache.
5. **Jobs in the cloud write no repo files:** the evaluate job skips the plots and the model card. Its results still go to `eval_runs` and storage; regenerate the card locally.
6. **Publish** runs as a placeholder until Phase 11.
7. **Build states:** `succeeded` becomes `ready`, and `insufficient_data` is new; the channel card's label changed with it.

**Dependency:** `google-cloud-firestore` 2.34.1, for the Python progress writer.

## Changes from the spec

All are recorded in `docs/plan/phase-10.md`.

- **Eight jobs, not six:** `job-extract-load` (Phase 05's load into BigQuery) and `job-baseline` (Phase 09's generic-LLM curves) are stages of their own.
- **The workflow's argument** is `{channel_id, run_id, mode, allow_small}`.
- **`startChannelBuild` sets `queued`;** the workflow sets `running` when it starts.
- **A stale build can be replaced.** A build still marked queued or running whose execution has ended (cancelled, crashed or gone), or which was queued 5 minutes ago with no execution, no longer blocks a new one. Without this, a killed run would lock its channel for good.
- **Progress** is `{stage, done, total, etaS, updatedAt}` on `build.progress`, camelCase like the rest of the document.
- **Jobs bind `build_run_id` and `build_stage`** to their logs, not `run_id` and `stage`, which each command binds to its own run.
- **The weekly refresh** reruns ingest, extract and the later stages for ready channels only, after refitting the pooled models once. A refresh runs without `allow_small`.

## Incidents

In the order they happened during the live run:

- **Cloud Build could not read its own source (403).** Its service account needed `storage.objectViewer` on `gs://{project}_cloudbuild`. `09-orchestration.sh` now creates the bucket if missing and grants it.
- **`gcloud scheduler jobs update http` takes `--update-headers`;** only `create` takes `--headers`.
- **macOS's bash 3.2 treats an empty array as unset** under `set -u`, which broke `deploy-pipeline.sh` after 6 jobs.
- **Workflows rejected the YAML three times:**
  - `env` is a reserved name (now `job_env`);
  - a subworkflow parameter's default must be a literal (`clear: null`, read with `default(clear, [])`);
  - expressions cannot hold map literals, so `weekly_refresh` builds its argument in an assign step.
- **Every modeling job crashed on startup.** Three modules set default output folders by counting four folders up from their own file, which works in the repo but not in the image (`/app/src/soundcheck_modeling` has three above it). Train failed with `IndexError` on import. They now use `REPO_ROOT`, the folder with `pnpm-workspace.yaml`, or the working directory. A new test copies the package out of the repo and imports it, the case no test covered.
- **The failure message said nothing useful:** "An error occurred during execution of a long-running operation." The workflow now keeps the operation's own error, which names the job execution and its exit code.
- **Run IDs garbled in Cloud Logging.** The stage runner bound the build's `run_id`, and every command binds its own; pino repeats a key bound twice, and Cloud Logging merged the two values into one 64-character ID. Found in the extract job's logs.
- **My mistakes:**
  - I left the shell in `services/modeling`, so your `! bash infra/deploy-workflows.sh` found no such file.
  - A background watcher got a relative `--env-file` and failed.
  - I reported `job-evaluate` on the old image while your deploy was still running; my wait loop had stopped at an earlier job's line.
  - My kill script used `pnpm -s` (pnpm 12 has no such flag) and then waited on a confirmation prompt, so the kill landed a few seconds later than planned.

## Notes for later phases

- **Phase 11 fills in publish.** The workflow already runs `job-publish` after evaluate, and the build is `ready` only after it.
- **Container start-up dominates build time.** Options, if 20 minutes matters: one job for the TypeScript stages after extract, smaller images, or fewer workflow steps. Measure before changing anything.
- **A deterministic failure costs 6 container runs** (each job retries once, and the workflow tries 3 times), about 14 minutes before the build shows `failed`. Setting the single-task jobs to `--max-retries=0` would halve it; extract's task retries are worth keeping.
- **The weekly refresh runs without `allow_small`,** so a small channel built with it ends `insufficient_data` at the next Monday refresh. That is correct for real channels; rebuild with `--allow-small` for a demo.
- **Log keys:** filter a whole build in Cloud Logging with `jsonPayload.build_run_id`. The redaction rule (Phase 00) hides `prompt_tokens` and `output_tokens`, because it matches plurals; rename those keys if the numbers are wanted in logs. The `MaxListenersExceededWarning` from `@google-cloud/storage` appears in job logs and is harmless.
- **Python jobs print plain text,** with no `build_run_id`; find them by the job execution's name, which the build's error message now includes.
- **Redeploy after code changes:** the jobs run images from `infra/deploy-pipeline.sh`, not the repo. The images deployed on Oct 11 (`…-20261011085349`) include this commit's fixes.
- **An image tag names the last commit, but the build uses the working tree,** so uncommitted changes can ship under an older commit's ID (the Oct 11 images say `a6c0275`). Commit before deploying when the tag needs to mean something.
