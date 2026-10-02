import net from "node:net";
import { describe, expect, it } from "vitest";
import { NetworkAccessError } from "./no-network";

describe("no-network setup", () => {
  it("makes fetch fail before any request leaves the process", async () => {
    const error: unknown = await fetch("https://example.com").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).cause).toBeInstanceOf(NetworkAccessError);
  });

  it("blocks raw TCP connections", () => {
    expect(() => net.connect(443, "example.com")).toThrow(NetworkAccessError);
    expect(() => net.connect({ host: "127.0.0.1", port: 8080 })).toThrow(/127\.0\.0\.1:8080/);
  });
});
