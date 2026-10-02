import { Command } from "commander";
import { commands } from "./commands";

export function createProgram(): Command {
  const program = new Command("soundcheck")
    .description("Soundcheck batch pipeline, run as Cloud Run Jobs")
    .showHelpAfterError();
  for (const command of commands) {
    program
      .command(command.name)
      .description(command.description)
      .action(() => command.run());
  }
  return program;
}
