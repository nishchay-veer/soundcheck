import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { buildFeatures, formatFeatures } from "./run";

export const features: PipelineCommand = {
  name: "features",
  description: "Align beats to the 100-bin timeline and write the feature matrix",
  configure(command) {
    command
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .option("--force", "rewrite training_bins even when nothing changed", false)
      .action(async ({ channel, force }: { channel: string; force: boolean }) => {
        const result = await buildFeatures({ channelId: channel, force });
        process.stdout.write(`${formatFeatures(result)}\n`);
      });
  },
};
