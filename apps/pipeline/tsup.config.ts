import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  target: "node24",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  // Workspace packages are TypeScript source, so they are bundled in. Every
  // other import (pino, the Google Cloud clients) stays external and is
  // resolved from node_modules at runtime.
  skipNodeModulesBundle: true,
  noExternal: [/^@soundcheck\//],
});
