import { describe, expect, it } from "vitest";
import { accessDecision } from "./access";

describe("accessDecision", () => {
  it.each(["/api/v1/me", "/api/v1/channels/UCaBcDeFgHiJkLmNoPqRsTuV"])(
    "rejects an anonymous call to %s with 401",
    (path) => {
      expect(accessDecision(path, false)).toBe("unauthorized");
    },
  );

  it("sends an anonymous page request to sign in", () => {
    expect(accessDecision("/app", false)).toBe("sign-in");
    expect(accessDecision("/app/channels/x", false)).toBe("sign-in");
  });

  it.each(["/api/healthz", "/api/auth/signin", "/api/auth/callback/google"])(
    "leaves %s public",
    (path) => {
      expect(accessDecision(path, false)).toBe("allow");
    },
  );

  it("does not treat look-alike paths as public", () => {
    expect(accessDecision("/api/authz", false)).toBe("unauthorized");
    expect(accessDecision("/api/healthz-admin", false)).toBe("unauthorized");
  });

  it("allows signed-in requests", () => {
    expect(accessDecision("/api/v1/me", true)).toBe("allow");
    expect(accessDecision("/app", true)).toBe("allow");
  });
});
