import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT || "3000";
const baseURL = `http://127.0.0.1:${port}`;
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "true";

export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    baseURL,
    launchOptions: executablePath ? { executablePath } : undefined,
    trace: "on-first-retry",
  },
  webServer: {
    command: `NUXT_PUBLIC_ALLOW_ANONYMOUS_MODE=true NUXT_PUBLIC_DEFAULT_LOOKBACK_MINUTES=15 bun run dev --port ${port}`,
    url: `${baseURL}/login`,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
