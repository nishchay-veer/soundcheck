import { describe, expect, it } from "vitest";
import { appHome, pickChannel } from "./app-home";

describe("appHome", () => {
  it("sends each build state to its screen, and revoked access to reconnect", () => {
    const at = (state: string, status = "connected") =>
      appHome({ status, build: { state } } as Parameters<typeof appHome>[0]);
    expect(at("ready")).toBe("/app/audiences");
    for (const state of ["not_started", "queued", "running", "failed", "insufficient_data"]) {
      expect(at(state)).toBe("/app/building");
    }
    expect(at("ready", "reauth_required")).toBe("/reauth");
  });
});

describe("pickChannel", () => {
  it("keeps the chosen channel while the user has it, and falls back to the first", () => {
    const channels = [{ id: "UCa" }, { id: "UCb" }];
    expect(pickChannel(channels, "UCb")?.id).toBe("UCb");
    expect(pickChannel(channels, "UCgone")?.id).toBe("UCa");
    expect(pickChannel(channels, undefined)?.id).toBe("UCa");
    expect(pickChannel([], "UCa")).toBeNull();
  });
});
