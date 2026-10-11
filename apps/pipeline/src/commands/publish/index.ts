import { channelIdOption } from "../options";
import type { PipelineCommand } from "../types";
import { publishChannel, type PublishResult } from "./run";

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** What publish did, for the terminal and the job's output. */
export function formatPublish(result: PublishResult): string {
  const captions = result.templated ? `, ${count(result.templated, "caption")} from templates` : "";
  const removed = result.deleted ? `, ${count(result.deleted, "old page")} removed` : "";
  const status = result.written ? "written" : "unchanged, nothing written";
  const warning = result.notUsable
    ? '; models not usable: screens must say "not a result yet"'
    : "";
  return `publish: ${count(result.videos, "video")}, ${count(result.drops, "drop-off")}${captions}${removed} (${status})${warning}`;
}

export const publish: PipelineCommand = {
  name: "publish",
  description: "Write screen documents to Firestore from model artifacts",
  configure(command) {
    command
      .requiredOption("--channel <id>", "a connected channel's ID", channelIdOption)
      .option("--force", "rewrite the documents even when nothing changed", false)
      .action(async ({ channel, force }: { channel: string; force: boolean }) => {
        process.stdout.write(
          `${formatPublish(await publishChannel({ channelId: channel, force }))}\n`,
        );
      });
  },
};
