import { channelIdSchema } from "@soundcheck/core/schemas";
import { InvalidArgumentError } from "commander";

/** commander parser for `--channel`: a "UC…" channel ID, checked before any work. */
export function channelIdOption(value: string): string {
  if (!channelIdSchema.safeParse(value).success) {
    throw new InvalidArgumentError("expected a channel ID: UC followed by 22 characters");
  }
  return value;
}

/** commander parser for a positive whole number, e.g. `--limit`. */
export function positiveIntegerOption(value: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new InvalidArgumentError("expected a positive whole number");
  }
  return number;
}
