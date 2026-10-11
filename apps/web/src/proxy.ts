import { fixturesMode } from "@soundcheck/core/env";
import NextAuth from "next-auth";
import {
  NextResponse,
  type NextFetchEvent,
  type NextMiddleware,
  type NextRequest,
} from "next/server";
import { authConfig } from "./auth.config";
import { accessDecision } from "./lib/access";

// Session check only: auth.config has no Google SDK or Firestore.
const { auth } = NextAuth(() => authConfig());

// With a lazy config, Auth.js returns this wrapped handler as a Promise, so it
// is awaited inside a plain function: Next requires the default export to be one.
const checkSession = auth((request) => {
  switch (accessDecision(request.nextUrl.pathname, Boolean(request.auth?.userId))) {
    case "unauthorized":
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    case "sign-in":
      return NextResponse.redirect(new URL("/", request.nextUrl));
    default:
      return NextResponse.next();
  }
});

export default async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Fixtures mode (development only) has no sign-in: the fixture user is everyone.
  if (fixturesMode()) return NextResponse.next();
  // auth()'s overloads type the wrapped handler as a route handler; it is a proxy.
  const handler = (await checkSession) as unknown as NextMiddleware;
  return handler(request, event);
}

export const config = {
  matcher: ["/app/:path*", "/api/v1/:path*"],
};
