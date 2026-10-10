import { InvalidArgumentError } from "commander";
import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { STAGES, runStage, type BuildMode, type Stage } from "./run";

const stageArgument = (value: string): Stage => {
  if (!(STAGES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`expected one of ${STAGES.join(", ")}`);
  }
  return value as Stage;
};

const modeOption = (value: string): BuildMode => {
  if (value !== "build" && value !== "refresh") {
    throw new InvalidArgumentError("expected build or refresh");
  }
  return value;
};

export const stage: PipelineCommand = {
  name: "stage",
  description: "Run one stage of the channel build, as its Cloud Run job does (Phase 10)",
  configure(command) {
    command
      .argument("<stage>", STAGES.join(" | "), stageArgument)
      .option("--channel <id>", "the channel (default: the job's CHANNEL_ID)", channelIdOption)
      .option("--mode <mode>", "build or refresh (default: the job's BUILD_MODE)", modeOption)
      .action(async (name: Stage, flags: { channel?: string; mode?: BuildMode }) => {
        const line = await runStage(name, { channelId: flags.channel, mode: flags.mode });
        process.stdout.write(`${line}\n`);
      });
  },
};
