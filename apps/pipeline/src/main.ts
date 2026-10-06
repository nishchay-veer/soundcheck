#!/usr/bin/env node
import { logger, ReauthRequiredError } from "@soundcheck/core";
import { createProgram } from "./cli";

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  logger.fatal(
    { err: error },
    error instanceof ReauthRequiredError
      ? "the channel's YouTube access was revoked; the creator must reconnect it"
      : "command failed",
  );
  process.exitCode = 1;
}
