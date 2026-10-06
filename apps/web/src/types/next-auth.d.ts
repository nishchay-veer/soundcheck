import "next-auth";

declare module "next-auth" {
  interface Session {
    /** The Google account's `sub`. Set once the user has signed in. */
    userId?: string;
    channelIds?: string[];
  }
}
