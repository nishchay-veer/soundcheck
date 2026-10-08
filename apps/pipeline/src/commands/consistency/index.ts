import { channelIdOption, positiveIntegerOption } from "../options";
import type { PipelineCommand } from "../types";
import { formatConsistency, runConsistency } from "./run";

export const consistency: PipelineCommand = {
  name: "consistency",
  description: "Measure how consistently Gemini labels the same video",
  configure(command) {
    command
      .requiredOption("--channel <id>", "the connected channel that runs the gate", channelIdOption)
      .option("--runs <n>", "extractions per video (at least 2)", positiveIntegerOption, 3)
      .option("--temperature <t>", "sampling temperature for the runs", Number, 0)
      .action(
        async ({
          channel,
          runs,
          temperature,
        }: {
          channel: string;
          runs: number;
          temperature: number;
        }) => {
          const report = await runConsistency({ channelId: channel, runs, temperature });
          process.stdout.write(`${formatConsistency(report)}\n`);
        },
      );
  },
};
