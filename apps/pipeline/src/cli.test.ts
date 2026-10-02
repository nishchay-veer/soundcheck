import { afterEach, describe, expect, it, vi } from "vitest";
import { createProgram } from "./cli";
import { commands } from "./commands";

describe("soundcheck CLI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  it.each(commands.map((command) => command.name))("%s prints not implemented", async (name) => {
    const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    await createProgram().parseAsync(["node", "soundcheck", name]);
    expect(write).toHaveBeenCalledWith(`${name}: not implemented\n`);
  });
});
