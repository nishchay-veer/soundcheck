import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { formatBaselineRun, runBaselineLlm } from "./run";

interface BaselineFlags {
  channel: string;
  video?: string;
  cache: boolean;
}

export const baselineLlm: PipelineCommand = {
  name: "baseline-llm",
  description: "Ask Gemini for a generic retention curve of each held-out video (Phase 09, B1)",
  configure(command) {
    command
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .option("--video <id>", "only this video of the channel")
      .option("--no-cache", "ask Gemini again even when a cached curve exists")
      .action(async ({ channel, video, cache }: BaselineFlags) => {
        const run = await runBaselineLlm({ channelId: channel, video, noCache: !cache });
        process.stdout.write(`${formatBaselineRun(run)}\n`);
      });
  },
};
