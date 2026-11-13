import type { Page } from '@playwright/test'

export async function mockManagedDeployment(
  page: Page,
  availability: { eventHub: boolean; logAnalytics: boolean },
) {
  await page.route('**/api/capabilities', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        mode: 'managed',
        eventHubAvailable: availability.eventHub,
        predefinedLogAnalyticsAvailable: availability.logAnalytics,
        temporaryLogAnalyticsAuthAvailable: false,
        errors: [],
      },
    })
  })
  await page.route('**/api/_auth/session', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        expireAt: Math.floor(Date.now() / 1_000) + 3_600,
        canRefresh: false,
        userName: 'Managed User',
        claims: { preferred_username: 'managed@example.com' },
        provider: 'entra',
      },
    })
  })
}
