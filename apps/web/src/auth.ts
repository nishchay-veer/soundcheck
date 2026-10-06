import { connectChannel, getUserChannelIds } from "@soundcheck/core/data";
import NextAuth from "next-auth";
import { authConfig } from "./auth.config";
import { signInErrorRedirect } from "./lib/sign-in-errors";

/**
 * Full Auth.js config for the Node runtime. Sign-in connects the channel
 * (connectChannel encrypts the refresh token and writes Firestore); the JWT
 * keeps only the user ID and channel IDs. Tokens never reach the browser.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => {
  const base = authConfig();
  return {
    ...base,
    callbacks: {
      ...base.callbacks,
      async signIn({ account, profile, user }) {
        if (account?.provider !== "google" || !account.access_token) return false;
        try {
          await connectChannel({
            googleSub: account.providerAccountId,
            email: profile?.email ?? user.email ?? "",
            accessToken: account.access_token,
            refreshToken: account.refresh_token,
            expiresAt: account.expires_at,
            scope: account.scope ?? "",
          });
          return true;
        } catch (error) {
          // Returning a path aborts sign-in and redirects there.
          return signInErrorRedirect(error);
        }
      },
      async jwt({ token, account }) {
        if (account) {
          token.userId = account.providerAccountId;
          token.channelIds = await getUserChannelIds(account.providerAccountId);
        }
        return token;
      },
    },
  };
});
