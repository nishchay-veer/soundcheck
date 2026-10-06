import { ChannelOwnedError, MissingScopesError, NoChannelError, logger } from "@soundcheck/core";

/**
 * Where a failed connect sends the user. Known failures get an explanation
 * page; anything else is logged and gets the generic error page.
 */
export function signInErrorRedirect(error: unknown, log = logger): string {
  if (error instanceof MissingScopesError) return "/connect/missing-scopes";
  if (error instanceof NoChannelError) return "/connect/no-channel";
  if (error instanceof ChannelOwnedError) return "/connect/channel-taken";
  log.error({ err: error, stage: "connect" }, "channel connect failed during sign-in");
  return "/connect/error";
}
