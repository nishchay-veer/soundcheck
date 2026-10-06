import { pickServerEnv } from "@soundcheck/core/env";
import { SIGN_IN_SCOPES, sessionClaimsSchema } from "@soundcheck/core/schemas";
import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/**
 * Auth.js settings shared by the proxy and the full config in auth.ts. Nothing
 * here touches a Google SDK or Firestore: the proxy only reads the session
 * cookie. Built per request so env is read at runtime, not at build time.
 */
export function authConfig(): NextAuthConfig {
  const env = pickServerEnv(["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "AUTH_SECRET", "AUTH_URL"]);
  return {
    secret: env.AUTH_SECRET,
    trustHost: true,
    session: { strategy: "jwt" },
    pages: { signIn: "/", error: "/connect/error" },
    providers: [
      Google({
        clientId: env.AUTH_GOOGLE_ID,
        clientSecret: env.AUTH_GOOGLE_SECRET,
        authorization: {
          params: {
            scope: SIGN_IN_SCOPES.join(" "),
            access_type: "offline",
            // Required for Google to return a refresh token on every sign-in.
            prompt: "consent",
            include_granted_scopes: "true",
          },
        },
      }),
    ],
    callbacks: {
      session({ session, token }) {
        const claims = sessionClaimsSchema.safeParse(token);
        if (claims.success) {
          session.userId = claims.data.userId;
          session.channelIds = claims.data.channelIds;
        }
        return session;
      },
    },
  };
}
