import type { Command } from "commander";
import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { ingestCatalogue } from "./catalogue";
import { ingestMix } from "./mix";
import { formatCoverage, ingestRetention } from "./retention";
import { ingestStats } from "./stats";

interface StepFlags {
  channel: string;
  force: boolean;
}

/** `--channel UC…` (required) and `--force`. */
function step(parent: Command, name: string, description: string): Command {
  return parent
    .command(name)
    .description(description)
    .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
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
    step(
      command,
      "stats",
      "Views and watch time per eligible video, for subscribers and non-subscribers",
    ).action(async ({ channel, force }: StepFlags) => {
      await ingestStats({ channelId: channel, force });
    });
    step(
      command,
      "mix",
      "Traffic-source and device mix per eligible video, for subscribers and non-subscribers",
    ).action(async ({ channel, force }: StepFlags) => {
      await ingestMix({ channelId: channel, force });
    });
    step(
      command,
      "retention",
      "Retention curves per eligible video and audience, with survival, hazards and coverage",
    ).action(async ({ channel, force }: StepFlags) => {
      const result = await ingestRetention({ channelId: channel, force });
      if (result) process.stdout.write(`${formatCoverage(result.summary)}\n`);
    });
  },
};
