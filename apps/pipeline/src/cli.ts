import { Command } from "commander";
import { commands } from "./commands";

export function createProgram(): Command {
  const program = new Command("soundcheck")
    .description("Soundcheck batch pipeline, run as Cloud Run Jobs")
    .showHelpAfterError();
  for (const command of commands) {
    command.configure(program.command(command.name).description(command.description));
  }
  return program;
}
