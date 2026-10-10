import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli";
import { commands } from "./commands";

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
      "publish",
      "soundcheck",
    ]);
  });

  it.each(
    commands
      .map((command) => command.name)
      .filter((name) => !["ingest", "extract", "consistency", "features"].includes(name)),
  )("%s prints not implemented", async (name) => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await createProgram().parseAsync(["node", "soundcheck", name]);
    expect(write).toHaveBeenCalledWith(`${name}: not implemented\n`);
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
  });

  it("rejects a malformed channel ID before doing anything", async () => {
    expect(await parse("ingest", "catalogue", "--channel", "../users")).toMatch(
      /expected a channel ID/,
    );
  });
});
