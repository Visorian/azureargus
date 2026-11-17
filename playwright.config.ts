import { defineConfig, devices } from '@playwright/test'

const configuredPort = process.env.PLAYWRIGHT_PORT
const port = configuredPort === undefined || configuredPort === '' ? '3000' : configuredPort
const baseURL = `http://127.0.0.1:${port}`
const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === 'true'
const delegatedClientId =
  process.env.NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID ??
  '11111111-1111-4111-8111-111111111111'

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    launchOptions:
      executablePath !== undefined && executablePath !== '' ? { executablePath } : undefined,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `bun run dev --port ${port}`,
    env: {
      NUXT_PUBLIC_DEFAULT_LOOKBACK_MINUTES:
        process.env.NUXT_PUBLIC_DEFAULT_LOOKBACK_MINUTES ?? '15',
      NUXT_PUBLIC_LOG_ANALYTICS_DELEGATED_CLIENT_ID: delegatedClientId,
    },
    url: `${baseURL}/login`,
    reuseExistingServer,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
