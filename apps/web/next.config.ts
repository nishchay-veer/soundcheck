import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const monorepoRoot = fileURLToPath(new URL("../..", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: monorepoRoot,
  turbopack: { root: monorepoRoot },
  transpilePackages: ["@soundcheck/core", "@soundcheck/ui"],
  typescript: {
    // Next.js cannot load the native TypeScript 7 compiler, so `next build`
    // skips type checking; `pnpm check` runs `tsc --noEmit` instead.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
