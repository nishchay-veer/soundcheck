import { Agent, fetch as undiciFetch } from "undici";
import { describe, expect, it, vi } from "vitest";
import { GEMINI_WAIT_MS, geminiFetch } from "./fetch";

// The real timeouts are exercised against a local server in fetch.integration.test.ts.
vi.mock("undici", () => ({
  Agent: vi.fn(function Agent(this: { options: unknown }, options: unknown) {
    this.options = options;
  }),
  fetch: vi.fn(async () => new Response("{}")),
}));

describe("geminiFetch", () => {
  it("waits 15 minutes for an answer by default, three times fetch's own 5", () => {
    geminiFetch();
    expect(GEMINI_WAIT_MS).toBe(15 * 60 * 1000);
    expect(Agent).toHaveBeenLastCalledWith({
      headersTimeout: GEMINI_WAIT_MS,
      bodyTimeout: GEMINI_WAIT_MS,
    });
  });

  it("sends each request unchanged, through the agent with the longer waits", async () => {
    const send = geminiFetch(1234);
    const agent = vi.mocked(Agent).mock.instances.at(-1);
    expect(Agent).toHaveBeenLastCalledWith({ headersTimeout: 1234, bodyTimeout: 1234 });
    const response = await send("https://aiplatform.googleapis.com/v1/x:generateContent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"contents":[]}',
    });
    expect(response.status).toBe(200);
    expect(undiciFetch).toHaveBeenLastCalledWith(
      "https://aiplatform.googleapis.com/v1/x:generateContent",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"contents":[]}',
        dispatcher: agent,
      },
    );
  });
});
