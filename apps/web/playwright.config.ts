import { defineConfig } from "@playwright/test";

/**
 * One smoke test of the app in fixtures mode, in the installed Chrome (no
 * browser download): `pnpm --filter @soundcheck/web test:e2e`. Its server has
 * no sign-in settings and no Google credentials, so passing also shows that
 * fixtures mode needs neither. Not part of `pnpm check`.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  reporter: "list",
  use: { baseURL: `http://localhost:${PORT}`, channel: "chrome" },
  projects: [
    { name: "phone", use: { viewport: { width: 390, height: 844 } } },
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    // Stop the dev server (and the workers it starts) when the tests end.
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
    env: {
      NEXT_PUBLIC_USE_FIXTURES: "true",
      AUTH_SECRET: "",
      AUTH_GOOGLE_ID: "",
      AUTH_GOOGLE_SECRET: "",
      GOOGLE_APPLICATION_CREDENTIALS: "/nonexistent/credentials.json",
      CLOUDSDK_CONFIG: "/nonexistent",
    },
  },
});
