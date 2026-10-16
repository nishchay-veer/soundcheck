import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { errorMessage } from "./extract";
import { geminiFetch } from "./fetch";

/** A server that answers after `?delay=` milliseconds, echoing the request. */
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      const delay = Number(new URL(request.url ?? "/", "http://x").searchParams.get("delay"));
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ method: request.method, type: request.headers["content-type"], body }),
        );
      }, delay);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections();
  server.close();
});

// A local server only: no Google call, so it is cheap to run with the integration tests.
describe("geminiFetch against a slow server", () => {
  it("waits as long as it is told for an answer to start, and passes the request through", async () => {
    const response = await geminiFetch(2000)(`${base}/?delay=300`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"contents":[]}',
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      method: "POST",
      type: "application/json",
      body: '{"contents":[]}',
    });
  });

  it("gives up with fetch's own timeout error once the wait is over", async () => {
    const error = await geminiFetch(100)(`${base}/?delay=1000`).catch((caught: unknown) => caught);
    expect(errorMessage(error)).toBe("fetch failed (UND_ERR_HEADERS_TIMEOUT)");
  });
});
