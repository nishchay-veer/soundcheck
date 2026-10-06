import {
  ChannelOwnedError,
  MissingScopesError,
  NoChannelError,
  createLogger,
} from "@soundcheck/core";
import { describe, expect, it } from "vitest";
import { signInErrorRedirect } from "./sign-in-errors";

const quiet = createLogger({ level: "silent" });

describe("signInErrorRedirect", () => {
  it.each([
    [
      new MissingScopesError(["https://www.googleapis.com/auth/yt-analytics.readonly"]),
      "/connect/missing-scopes",
    ],
    [new NoChannelError(), "/connect/no-channel"],
    [new ChannelOwnedError("UCaBcDeFgHiJkLmNoPqRsTuV"), "/connect/channel-taken"],
    [new Error("KMS unavailable"), "/connect/error"],
  ])("sends %s to %s", (error, path) => {
    expect(signInErrorRedirect(error, quiet)).toBe(path);
  });
});
