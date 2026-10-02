import { fileURLToPath } from "node:url";
import type { ViteUserConfig } from "vitest/config";

const noNetworkSetup = fileURLToPath(new URL("./no-network.ts", import.meta.url));

/** Integration tests are tagged by file name and never run in `pnpm check`. */
export const INTEGRATION_TEST_GLOB = "**/*.integration.test.{ts,tsx}";

const ignored = ["**/node_modules/**", "**/dist/**", "**/.next/**"];

/**
 * Shared Vitest config with two projects:
 * - `unit` (the `test` script): network blocked, integration tests excluded.
 * - `integration` (the `test:integration` script): real network allowed.
 */
export function soundcheckVitestConfig(): ViteUserConfig {
  return {
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: "unit",
            environment: "node",
            include: ["**/*.test.{ts,tsx}"],
            exclude: [...ignored, INTEGRATION_TEST_GLOB],
            setupFiles: [noNetworkSetup],
          },
        },
        {
          extends: true,
          test: {
            name: "integration",
            environment: "node",
            include: [INTEGRATION_TEST_GLOB],
            exclude: ignored,
          },
        },
      ],
    },
  };
}
