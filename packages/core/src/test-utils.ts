import type { DestinationStream } from "pino";
import { createLogger } from "./logger";

/** A logger that collects parsed JSON lines instead of writing to stdout. */
export function memoryLogger() {
  const lines: Record<string, unknown>[] = [];
  const destination: DestinationStream = {
    write: (line: string) => {
      lines.push(JSON.parse(line) as Record<string, unknown>);
    },
  };
  return { lines, logger: createLogger({ level: "debug", destination }) };
}
