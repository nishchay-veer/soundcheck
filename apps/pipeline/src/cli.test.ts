import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli";

describe("soundcheck CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Parses argv without exiting the test process; returns what commander wrote to stderr. */
  async function parse(...argv: string[]): Promise<string> {
    let stderr = "";
    const program = createProgram();
    for (const command of [
      program,
      ...program.commands,
      ...program.commands.flatMap((c) => c.commands),
    ]) {
      command.exitOverride().configureOutput({ writeErr: (text) => (stderr += text) });
    }
    await program.parseAsync(["node", "soundcheck", ...argv]).catch(() => undefined);
    return stderr;
  }

  it("registers every pipeline command", () => {
    const names = createProgram().commands.map((command) => command.name());
    expect(names).toEqual([
      "ingest",
      "extract",
      "consistency",
      "features",
      "traits",
      "baseline-llm",
      "stage",
      "build",
      "publish",
      "soundcheck",
    ]);
  });

  it("checks a soundcheck's IDs before any work", async () => {
    expect(
      await parse("soundcheck", "--channel", "UC-BHlgFbFh3V76yth-XCmlw", "--id", "../x"),
    ).toMatch(/expected a soundcheck ID/);
    expect(
      await parse("soundcheck", "--channel", "nope", "--id", "8f14e45fceea167a5a36dedd4bea2543"),
    ).toMatch(/expected a channel ID/);
    vi.stubEnv("CHANNEL_ID", "");
    vi.stubEnv("SOUNDCHECK_ID", "");
    await expect(createProgram().parseAsync(["node", "soundcheck", "soundcheck"])).rejects.toThrow(
      /Pass --channel and --id/,
    );
    vi.unstubAllEnvs();
  });

  it("has ingest subcommands", () => {
    const ingest = createProgram().commands.find((command) => command.name() === "ingest");
    expect(ingest?.commands.map((command) => command.name())).toEqual([
      "catalogue",
      "stats",
      "mix",
      "retention",
    ]);
  });

  it("has extract subcommands", () => {
    const extract = createProgram().commands.find((command) => command.name() === "extract");
    expect(extract?.commands.map((command) => command.name())).toEqual(["beats", "load"]);
  });

  it("has consistency subcommands", () => {
    const consistency = createProgram().commands.find(
      (command) => command.name() === "consistency",
    );
    expect(consistency?.commands.map((command) => command.name())).toEqual([
      "runs",
      "human",
      "gate",
    ]);
  });

  it("rejects a non-numeric --limit", async () => {
    expect(
      await parse("extract", "beats", "--channel", "UCaBcDeFgHiJkLmNoPqRsTuV", "--limit", "two"),
    ).toMatch(/expected a positive whole number/);
  });

  it("requires --channel", async () => {
    expect(await parse("ingest", "catalogue")).toMatch(/required option '--channel <id>'/);
    expect(await parse("features")).toMatch(/required option '--channel <id>'/);
    expect(await parse("traits")).toMatch(/required option '--channel <id>'/);
    expect(await parse("baseline-llm")).toMatch(/required option '--channel <id>'/);
    expect(await parse("build", "start")).toMatch(/required option '--channel <id>'/);
  });

  it("names the stages a job can run", async () => {
    expect(await parse("stage", "train")).toMatch(
      /expected one of ingest, extract, extract-load, features, baseline, publish/,
    );
    expect(await parse("stage", "ingest", "--mode", "weekly")).toMatch(/expected build or refresh/);
  });

  it("rejects a malformed channel ID before doing anything", async () => {
    expect(await parse("ingest", "catalogue", "--channel", "../users")).toMatch(
      /expected a channel ID/,
    );
  });
});
