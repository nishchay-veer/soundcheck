import type { PipelineCommand } from "../types";
import { channelIdOption, positiveIntegerOption } from "../options";
import { extractBeats, formatExtraction } from "./beats";
import { loadBeats } from "./load";

interface BeatsFlags {
  channel: string;
  video?: string;
  limit?: number;
  cache: boolean;
}

export const extract: PipelineCommand = {
  name: "extract",
  description: "Segment every video into typed beats with Gemini",
  configure(command) {
    command
      .command("beats")
      .description("Gemini beats for the channel's eligible videos, cached and validated")
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .option("--video <id>", "only this video of the channel, eligible or not")
      .option("--limit <n>", "at most this many videos", positiveIntegerOption)
      .option("--no-cache", "ask Gemini again even when a cached extraction exists")
      .action(async ({ channel, video, limit, cache }: BeatsFlags) => {
        const result = await extractBeats({ channelId: channel, video, limit, noCache: !cache });
        process.stdout.write(`${formatExtraction(result)}\n`);
      });
    command
      .command("load")
      .description(
        "Rebuild the channel's beats, beat_videos and extraction_runs rows from the cache",
      )
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .action(async ({ channel }: { channel: string }) => {
        await loadBeats(channel);
      });
  },
};
