import { positiveIntegerOption, channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { buildTraits, formatTraits } from "./run";

export const traits: PipelineCommand = {
  name: "traits",
  description: "Turn a channel's fitted models into readable traits by simulation",
  configure(command) {
    command
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .option("--draws <n>", "coefficient draws per interval", positiveIntegerOption, 200)
      .option("--seed <n>", "the random seed, for reproducible intervals", positiveIntegerOption, 1)
      .action(
        async ({ channel, draws, seed }: { channel: string; draws: number; seed: number }) => {
          process.stdout.write(
            `${formatTraits(await buildTraits({ channelId: channel, draws, seed }))}\n`,
          );
        },
      );
  },
};
