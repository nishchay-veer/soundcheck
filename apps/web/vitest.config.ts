import { fileURLToPath } from "node:url";
import { soundcheckVitestConfig } from "@soundcheck/vitest-config";
import { defineConfig, mergeConfig } from "vitest/config";

export default mergeConfig(
  soundcheckVitestConfig(),
  defineConfig({
    resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
    // tsconfig leaves JSX to Next.js ("preserve"); tests compile it themselves.
    oxc: { jsx: { runtime: "automatic" } },
    test: {
      // next-auth imports "next/server" without an extension, which only a
      // bundler resolves; let Vite transform it instead of Node loading it.
      server: { deps: { inline: ["next-auth"] } },
    },
  }),
);
