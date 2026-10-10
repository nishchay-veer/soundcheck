import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { BuildInProgressError, BuildNotConfiguredError, NotFoundError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { FakeExecutions } from "../fake-workflows";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { channelBuildWorkflow, startChannelBuild } from "./build";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const WORKFLOW = "projects/soundcheck-test/locations/us-central1/workflows/channel_build";
const NOW = new Date("2026-10-10T09:00:00Z");
const quiet = createLogger({ level: "silent" });

describe("startChannelBuild", () => {
  let db: FakeFirestore;
  let executions: FakeExecutions;

  beforeEach(async () => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv("GCP_REGION", "us-central1");
    vi.stubEnv("WORKFLOW_CHANNEL_BUILD", "channel_build");
    db = new FakeFirestore();
    executions = new FakeExecutions();
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("workflowExecutions", executions.asExecutions());
    await db
      .collection("channels")
      .doc(CHANNEL)
      .set({ title: "A channel", build: { state: "not_started" } });
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const build = () => db.docs.get(`channels/${CHANNEL}`)?.build as Record<string, unknown>;
  const start = (options: Parameters<typeof startChannelBuild>[1] = {}) =>
    startChannelBuild(CHANNEL, { log: quiet, now: NOW, ...options });
  const setBuild = (value: Record<string, unknown>) =>
    db.collection("channels").doc(CHANNEL).update({ build: value });

  it("queues the build with a new run and starts the workflow with it", async () => {
    const started = await start();
    expect(started).toMatchObject({ channelId: CHANNEL, mode: "build" });
    expect(started.runId).toMatch(/^[0-9a-f]{32}$/);
    expect(executions.created).toEqual([
      {
        parent: WORKFLOW,
        argument: { channel_id: CHANNEL, run_id: started.runId, mode: "build", allow_small: false },
      },
    ]);
    expect(build()).toEqual({
      state: "queued",
      runId: started.runId,
      mode: "build",
      startedAt: NOW,
      execution: `${WORKFLOW}/executions/exec-1`,
    });
  });

  it("passes a refresh and allow_small through, and accepts a full workflow path", async () => {
    vi.stubEnv("WORKFLOW_CHANNEL_BUILD", "projects/p/locations/europe-west1/workflows/other");
    resetEnvCache();
    expect(channelBuildWorkflow()).toBe("projects/p/locations/europe-west1/workflows/other");
    await start({ mode: "refresh", allowSmall: true });
    expect(executions.created[0]?.argument).toMatchObject({ mode: "refresh", allow_small: true });
  });

  it("refuses while another build is queued or running", async () => {
    await start();
    await expect(start()).rejects.toBeInstanceOf(BuildInProgressError);
    await setBuild({ ...build(), state: "running" });
    await expect(start()).rejects.toThrow("already has a build running");
    expect(executions.created).toHaveLength(1);
  });

  it("replaces a running build whose execution ended without recording it", async () => {
    const first = await start();
    await setBuild({ ...build(), state: "running" });
    executions.states.set(first.execution, "CANCELLED");
    const second = await start();
    expect(second.runId).not.toBe(first.runId);
    expect(build()).toMatchObject({ state: "queued", runId: second.runId });

    executions.states.delete(second.execution); // the execution is gone altogether
    await setBuild({ ...build(), state: "running" });
    await expect(start()).resolves.toMatchObject({ channelId: CHANNEL });
  });

  it("replaces a queued build that never got an execution after five minutes", async () => {
    await setBuild({ state: "queued", runId: "lost", startedAt: new Date(NOW.getTime() - 60_000) });
    await expect(start()).rejects.toBeInstanceOf(BuildInProgressError);
    await setBuild({
      state: "queued",
      runId: "lost",
      startedAt: new Date(NOW.getTime() - 600_000),
    });
    await expect(start()).resolves.toMatchObject({ mode: "build" });
  });

  it("records a workflow that would not start as a failed build", async () => {
    executions.failCreate = new Error("7 PERMISSION_DENIED: workflows.executions.create");
    await expect(start()).rejects.toThrow("PERMISSION_DENIED");
    expect(build()).toMatchObject({
      state: "failed",
      stage: "start",
      error: "The workflow did not start: 7 PERMISSION_DENIED: workflows.executions.create",
    });
    // A failed build can be started again.
    executions.failCreate = undefined;
    await expect(start()).resolves.toMatchObject({ channelId: CHANNEL });
  });

  it("needs the workflow configured and the channel to exist", async () => {
    await expect(
      startChannelBuild("UCzzzzzzzzzzzzzzzzzzzzzz", { log: quiet }),
    ).rejects.toBeInstanceOf(NotFoundError);
    vi.stubEnv("WORKFLOW_CHANNEL_BUILD", "");
    resetEnvCache();
    await expect(start()).rejects.toBeInstanceOf(BuildNotConfiguredError);
    expect(build()).toEqual({ state: "not_started" });
  });
});
