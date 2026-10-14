/**
 * Errors with a meaning callers act on: sign-in maps them to explanation pages,
 * route handlers map them to status codes.
 */

/** The user unticked one or both YouTube permissions on the consent screen. */
export class MissingScopesError extends Error {
  constructor(readonly missing: readonly string[]) {
    super(`Missing required scopes: ${missing.join(", ")}`);
    this.name = "MissingScopesError";
  }
}

/** The Google account has no YouTube channel. */
export class NoChannelError extends Error {
  constructor() {
    super("This Google account has no YouTube channel");
    this.name = "NoChannelError";
  }
}

/** The channel is already connected by a different user. */
export class ChannelOwnedError extends Error {
  constructor(readonly channelId: string) {
    super(`Channel ${channelId} is connected to another account`);
    this.name = "ChannelOwnedError";
  }
}

/**
 * The resource does not exist or belongs to someone else. Both cases look the
 * same to the caller (404) so IDs cannot be probed.
 */
export class NotFoundError extends Error {
  constructor(readonly resource: string) {
    super(`${resource} not found`);
    this.name = "NotFoundError";
  }
}

/** Google rejected the channel's refresh token; the creator must reconnect. */
export class ReauthRequiredError extends Error {
  constructor(readonly channelId: string) {
    super(`Channel ${channelId} needs to be reconnected`);
    this.name = "ReauthRequiredError";
  }
}

/** A build of the channel is already queued or running; route handlers answer 409. */
export class BuildInProgressError extends Error {
  constructor(
    readonly channelId: string,
    readonly state: string,
  ) {
    super(`Channel ${channelId} already has a build ${state}`);
    this.name = "BuildInProgressError";
  }
}

/** WORKFLOW_CHANNEL_BUILD is not set, so builds cannot start (503). */
export class BuildNotConfiguredError extends Error {
  constructor() {
    super("Channel builds are not configured: set WORKFLOW_CHANNEL_BUILD");
    this.name = "BuildNotConfiguredError";
  }
}

/** Fixtures mode reads saved documents and never writes; route handlers answer 503. */
export class FixturesModeError extends Error {
  constructor(action: string) {
    super(`Fixtures mode is read-only: ${action} is not available`);
    this.name = "FixturesModeError";
  }
}

/** WORKFLOW_SOUNDCHECK is not set, so soundchecks cannot start (503). */
export class SoundcheckNotConfiguredError extends Error {
  constructor() {
    super("Soundchecks are not configured: set WORKFLOW_SOUNDCHECK");
    this.name = "SoundcheckNotConfiguredError";
  }
}

/** The channel has published nothing yet, so there is no model to predict with (409). */
export class NotBuiltError extends Error {
  constructor(readonly channelId: string) {
    super(`Channel ${channelId} has no published build yet`);
    this.name = "NotBuiltError";
  }
}

/** A new soundcheck the request itself rules out: the file's type or size, or the link. */
export class SoundcheckRejectedError extends Error {
  constructor(
    readonly code: "unsupported_type" | "too_large" | "invalid_link",
    message: string,
  ) {
    super(message);
    this.name = "SoundcheckRejectedError";
  }
}

/** Edits that cannot be applied together (a beat edited twice, a beat that does not exist): 400. */
export class InvalidEditsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidEditsError";
  }
}

/** The soundcheck has no prediction to simulate on yet: 409. */
export class SoundcheckNotReadyError extends Error {
  constructor(readonly soundcheckId: string) {
    super(`Soundcheck ${soundcheckId} is not ready`);
    this.name = "SoundcheckNotReadyError";
  }
}
