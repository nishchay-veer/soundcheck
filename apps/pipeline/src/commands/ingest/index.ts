import { channelIdSchema } from "@soundcheck/core/schemas";
import { InvalidArgumentError, type Command } from "commander";
import type { PipelineCommand } from "../types";
import { ingestCatalogue } from "./catalogue";

function channelId(value: string): string {
  if (!channelIdSchema.safeParse(value).success) {
    throw new InvalidArgumentError("expected a channel ID: UC followed by 22 characters");
  }
  return value;
}

interface StepFlags {
  channel: string;
  force: boolean;
}

/** `--channel UC…` (required) and `--force`. */
function step(parent: Command, name: string, description: string): Command {
  return parent
    .command(name)
    .description(description)
    .requiredOption("--channel <id>", "a connected channel's ID", channelId)
    .option("--force", "redo the step even if it already finished for this data date", false);
}

export const ingest: PipelineCommand = {
  name: "ingest",
  description: "Fetch the catalogue and audience data from the YouTube APIs into BigQuery",
  configure(command) {
    step(command, "catalogue", "Videos, their content type and training eligibility").action(
      async ({ channel, force }: StepFlags) => {
        await ingestCatalogue({ channelId: channel, force });
      },
    );
  },
};
