import { formatClock } from "@soundcheck/core/gemini";
import { channelIdOption, positiveIntegerOption } from "../options";
import type { PipelineCommand } from "../types";
import { draftHumanLabels, formatHumanAgreement, runHumanAgreement } from "./human";
import { formatConsistency, runConsistency } from "./run";

export const consistency: PipelineCommand = {
  name: "consistency",
  description: "Measure how consistently Gemini labels the same video",
  configure(command) {
    command
      .command("runs")
      .description("Extract the fixed test videos several times and check the quality gate")
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
    command
      .command("human")
      .description("Compare Gemini's beat types with hand labels in docs/quality/human-labels")
      .requiredOption("--channel <id>", "the connected channel that runs the gate", channelIdOption)
      .option("--labels <dir>", "directory of {videoId}.csv hand labels")
      .option("--draft", "write Gemini's beats into the CSVs for a person to correct")
      .option("--force", "with --draft: replace labels already written", false)
      .action(
        async ({
          channel,
          labels,
          draft,
          force,
        }: {
          channel: string;
          labels?: string;
          draft?: boolean;
          force: boolean;
        }) => {
          if (draft) {
            for (const video of await draftHumanLabels({
              channelId: channel,
              labelsDir: labels,
              force,
            })) {
              process.stdout.write(`\n${video.videoId} (${formatClock(video.durationS)})\n`);
              for (const beat of video.beats) {
                process.stdout.write(
                  `  ${beat.start.padStart(5)}–${beat.end.padEnd(6)} ${beat.beatType.padEnd(14)} ${beat.summary}\n`,
                );
              }
            }
            return;
          }
          const report = await runHumanAgreement({ channelId: channel, labelsDir: labels });
          process.stdout.write(`${formatHumanAgreement(report)}\n`);
        },
      );
  },
};
