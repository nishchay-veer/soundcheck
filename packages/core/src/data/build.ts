import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { pickServerEnv } from "../env";
import { BuildInProgressError, BuildNotConfiguredError, NotFoundError } from "../errors";
import { getFirestore, getWorkflowExecutions } from "../gcp";
import { childLogger, logger as rootLogger } from "../logger";
import { COLLECTIONS, buildSchema, type Build } from "../schemas";
import { refuseInFixturesMode } from "./store";

/**
 * Starting the `channel_build` workflow (Phase 10). The stages run in Cloud
 * Run jobs; nothing here runs a stage, so it is safe on a request path.
 */

export type BuildMode = "build" | "refresh";

export interface StartedBuild {
  channelId: string;
  runId: string;
  mode: BuildMode;
  /** The Workflows execution, `projects/…/workflows/…/executions/…`. */
  execution: string;
}

/** A queued build with no execution after this long never got started. */
const QUEUED_STALE_MS = 5 * 60_000;
/** Execution states in which the workflow is still at work. */
const LIVE_EXECUTION = new Set(["ACTIVE", "QUEUED", "1", "6"]);

/** The workflow's resource name, from WORKFLOW_CHANNEL_BUILD (a name or a full path). */
export function channelBuildWorkflow(): string | null {
  const env = pickServerEnv(["GCP_PROJECT_ID", "GCP_REGION", "WORKFLOW_CHANNEL_BUILD"]);
  const name = env.WORKFLOW_CHANNEL_BUILD;
  if (!name) return null;
  return name.startsWith("projects/")
    ? name
    : `projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_REGION}/workflows/${name}`;
}

const busy = (build: Build) => build.state === "queued" || build.state === "running";

/**
 * Whether a queued or running build is really gone: its execution ended
 * without the workflow recording it (a cancelled or crashed run), or it was
 * queued but never got an execution. Such a build may be started again.
 */
async function isStale(build: Build, now: Date): Promise<boolean> {
  if (!busy(build)) return false;
  if (!build.execution) {
    const started = build.startedAt instanceof Date ? build.startedAt.getTime() : now.getTime();
    return build.state === "queued" && now.getTime() - started > QUEUED_STALE_MS;
  }
  try {
    const [execution] = await getWorkflowExecutions().getExecution({ name: build.execution });
    return !LIVE_EXECUTION.has(String(execution.state));
  } catch (error) {
    if ((error as { code?: unknown }).code === 5) return true; // the execution is gone
    throw error;
  }
}

/**
 * Starts a build of the channel: marks it `queued` with a new run ID in a
 * Firestore transaction that refuses while another build is queued or running
 * (unless that one is stale), then starts the workflow with
 * `{channel_id, run_id, mode, allow_small}`. If the workflow cannot start, the
 * build is marked `failed` at stage `start`.
 *
 * `allowSmall` runs every stage even below MIN_TRAIN_VIDEOS, for testing and
 * demos; the models stay marked not usable.
 */
export async function startChannelBuild(
  channelId: string,
  {
    mode = "build",
    allowSmall = false,
    log = rootLogger,
    now = new Date(),
  }: { mode?: BuildMode; allowSmall?: boolean; log?: Logger; now?: Date } = {},
): Promise<StartedBuild> {
  refuseInFixturesMode("starting a build");
  const parent = channelBuildWorkflow();
  if (!parent) throw new BuildNotConfiguredError();
  const buildLog = childLogger({ channel_id: channelId, stage: "build" }, log);
  const ref = getFirestore().collection(COLLECTIONS.channels).doc(channelId);

  const current = await ref.get();
  if (!current.exists) throw new NotFoundError("channel");
  const before = buildSchema.parse(
    (current.data() as { build?: unknown }).build ?? { state: "not_started" },
  );
  const stale = await isStale(before, now);

  const runId = randomUUID().replaceAll("-", "");
  await getFirestore().runTransaction(async (tx) => {
    const snapshot = await tx.get(ref);
    const build = buildSchema.parse((snapshot.data() as { build?: unknown }).build);
    // A stale build may be replaced only if it is still the one checked above.
    if (busy(build) && !(stale && build.runId === before.runId)) {
      throw new BuildInProgressError(channelId, build.state);
    }
    tx.update(ref, { build: buildSchema.parse({ state: "queued", runId, mode, startedAt: now }) });
  });

  let execution: string;
  try {
    const [created] = await getWorkflowExecutions().createExecution({
      parent,
      execution: {
        argument: JSON.stringify({
          channel_id: channelId,
          run_id: runId,
          mode,
          allow_small: allowSmall,
        }),
      },
    });
    execution = created.name ?? "";
  } catch (error) {
    await ref.update({
      "build.state": "failed",
      "build.stage": "start",
      "build.error": `The workflow did not start: ${(error as Error).message}`.slice(0, 300),
      "build.finishedAt": new Date(),
    });
    throw error;
  }
  await ref.update({ "build.execution": execution });
  buildLog.info(
    { run_id: runId, mode, allow_small: allowSmall, execution, replaced_stale: stale },
    "build started",
  );
  return { channelId, runId, mode, execution };
}
