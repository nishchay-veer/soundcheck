import type { Command } from "commander";

export interface PipelineCommand {
  name: string;
  description: string;
  /** Adds the command's options, subcommands and action. */
  configure: (command: Command) => void;
}

/** For commands a later phase builds: prints "<name>: not implemented". */
export function notImplemented(name: string): (command: Command) => void {
  return (command) => {
    command.action(() => {
      process.stdout.write(`${name}: not implemented\n`);
    });
  };
}
