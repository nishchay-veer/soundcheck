export type AccessDecision = "allow" | "unauthorized" | "sign-in";

/** Paths under /api that never need a session. */
const PUBLIC_API = ["/api/auth", "/api/healthz"];

/**
 * The proxy's whole policy: signed-in requests pass; anonymous API calls get
 * 401; anonymous page requests go to the sign-in page.
 */
export function accessDecision(pathname: string, signedIn: boolean): AccessDecision {
  const isPublicApi = PUBLIC_API.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (signedIn || isPublicApi) return "allow";
  return pathname.startsWith("/api/") ? "unauthorized" : "sign-in";
}
