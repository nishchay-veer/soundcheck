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

  it.each(commands.map((command) => command.name).filter((name) => name !== "ingest"))(
    "%s prints not implemented",
    async (name) => {
      const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
      await createProgram().parseAsync(["node", "soundcheck", name]);
      expect(write).toHaveBeenCalledWith(`${name}: not implemented\n`);
    },
  );

  it("has ingest subcommands", () => {
    const ingest = createProgram().commands.find((command) => command.name() === "ingest");
    expect(ingest?.commands.map((command) => command.name())).toEqual([
      "catalogue",
      "stats",
      "mix",
    ]);
  });

  it("requires --channel", async () => {
    expect(await parse("ingest", "catalogue")).toMatch(/required option '--channel <id>'/);
  });

  it("rejects a malformed channel ID before doing anything", async () => {
    expect(await parse("ingest", "catalogue", "--channel", "../users")).toMatch(
      /expected a channel ID/,
    );
  });
});
