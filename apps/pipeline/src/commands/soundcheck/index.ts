import { getJobEnv } from "@soundcheck/core";
import { soundcheckIdSchema } from "@soundcheck/core/schemas";
import { InvalidArgumentError } from "commander";
import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { runSoundcheck, type SoundcheckRunResult } from "./run";

/** commander parser for `--id`: a soundcheck ID, checked before any work. */
function soundcheckIdOption(value: string): string {
  if (!soundcheckIdSchema.safeParse(value).success) {
    throw new InvalidArgumentError("expected a soundcheck ID: 32 lowercase hex characters");
  }
  return value;
}

/** What the run did, for the terminal and the job's output. */
export function formatSoundcheck(result: SoundcheckRunResult): string {
  switch (result.status) {
    case "ready":
      return `soundcheck ${result.soundcheckId}: ready (${Math.round(result.durationS)} s, ${result.beats} beats)`;
    case "failed":
      return `soundcheck ${result.soundcheckId}: failed (${result.code})`;
    case "skipped":
      return `soundcheck ${result.soundcheckId}: skipped (${result.reason})`;
  }
}

export const soundcheck: PipelineCommand = {
  name: "soundcheck",
  description: "Predict a new cut: check it, watch it and predict each audience",
  configure(command) {
    command
      .option("--channel <id>", "the channel (default: CHANNEL_ID)", channelIdOption)
      .option("--id <soundcheckId>", "the soundcheck (default: SOUNDCHECK_ID)", soundcheckIdOption)
      .action(async ({ channel, id }: { channel?: string; id?: string }) => {
        const env = getJobEnv();
        const channelId = channel ?? env.CHANNEL_ID;
        const soundcheckId = id ?? env.SOUNDCHECK_ID;
        if (!channelId || !soundcheckId) {
          throw new Error("Pass --channel and --id, or set CHANNEL_ID and SOUNDCHECK_ID");
        }
        const result = await runSoundcheck({ channelId, soundcheckId, runId: env.RUN_ID });
        process.stdout.write(`${formatSoundcheck(result)}\n`);
      });
  },
};
