import { Agent, fetch as undiciFetch } from "undici";

/**
 * How long a Gemini call may wait for its answer to start, and between parts
 * of it. Node's own fetch gives up after 5 minutes of silence
 * (`UND_ERR_HEADERS_TIMEOUT`), and Gemini can take longer than that to start
 * answering for a 20-minute window of a long video (Phase 06; on Oct 15, two
 * hour-long videos of a new channel failed this way in extract and baseline).
 */
export const GEMINI_WAIT_MS = 15 * 60 * 1000;

/** The fetch the Gemini SDK is given: undici's own, with the longer waits. */
export function geminiFetch(waitMs: number = GEMINI_WAIT_MS): typeof fetch {
  const dispatcher = new Agent({ headersTimeout: waitMs, bodyTimeout: waitMs });
  // undici's fetch speaks the standard fetch API; its types are its own copies of the DOM ones.
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) =>
    undiciFetch(
      input as Parameters<typeof undiciFetch>[0],
      { ...init, dispatcher } as Parameters<typeof undiciFetch>[1],
    )) as unknown as typeof fetch;
}
