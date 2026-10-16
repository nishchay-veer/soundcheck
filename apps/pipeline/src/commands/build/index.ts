import { startChannelBuild } from "@soundcheck/core/data";
import { InvalidArgumentError } from "commander";
import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";

interface StartFlags {
  channel: string;
  mode: "build" | "refresh";
}

const modeOption = (value: string): "build" | "refresh" => {
  if (value !== "build" && value !== "refresh") {
    throw new InvalidArgumentError("expected build or refresh");
  }
  return value;
};

export const build: PipelineCommand = {
  name: "build",
  description: "Start the channel_build workflow, as connecting a channel does (Phase 10)",
  configure(command) {
    command
      .command("start")
      .description("Queue a build of the channel and start its workflow")
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .option("--mode <mode>", "build or refresh", modeOption, "build")
      .action(async ({ channel, mode }: StartFlags) => {
        const started = await startChannelBuild(channel, { mode });
        process.stdout.write(
          `Build ${started.runId} (${mode}) queued for ${channel}\n` +
            `  execution: ${started.execution}\n`,
        );
      });
  },
};
