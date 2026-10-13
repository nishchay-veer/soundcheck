import type { Command } from "commander";

export interface PipelineCommand {
  name: string;
  description: string;
  /** Adds the command's options, subcommands and action. */
  configure: (command: Command) => void;
}
