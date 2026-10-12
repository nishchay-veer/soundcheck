import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

/**
 * One .env at the repo root serves the web app, the pipeline and scripts. Next
 * only reads .env files from apps/web (and caches that result in @next/env),
 * so the root file is merged here. Values already in the environment win, so
 * Cloud Run's configuration is never overridden.
 */
function loadRootEnv(root: string): void {
  const file = join(root, ".env");
  if (!existsSync(file)) return;
  for (const [name, value] of Object.entries(parseEnv(readFileSync(file, "utf8")))) {
    process.env[name] ??= value;
  }
}

loadRootEnv(monorepoRoot);

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  // Fixtures mode reads these at a runtime path, so the tracer would copy them
  // into every production build; production never reads them.
  outputFileTracingExcludes: { "*": ["./fixtures/**"] },
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@soundcheck/core", "@soundcheck/ui"],
  images: {
    // Channel avatars, and video thumbnails.
    remotePatterns: [
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "yt3.googleusercontent.com" },
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/vi/**" },
    ],
  },
  typescript: {
    // Next.js cannot load the native TypeScript 7 compiler, so `next build`
    // skips type checking; `pnpm check` runs `tsc --noEmit` instead.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
