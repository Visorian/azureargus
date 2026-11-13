import { expect, test } from '@playwright/test'

import { openSettings } from './support/logsWorkspace'

test('application routes keep the Azure Argus title without loading the redirect bridge', async ({
  page,
}) => {
  const redirectBridgeRequests: string[] = []
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/_nuxt/log-analytics-redirect.js') {
      redirectBridgeRequests.push(request.url())
    }
  })

  await page.goto('/')
  await expect(page).toHaveTitle('Azure Argus')

  await page.goto('/logs')
  await expect(page).toHaveTitle('Azure Argus')
  await openSettings(page)
  await expect(page).toHaveTitle('Azure Argus')
  expect(redirectBridgeRequests).toEqual([])
})

for (const outcome of [
  { granted: true, preference: 'dark', system: 'light', title: 'Tenant consent granted' },
  { granted: false, preference: 'light', system: 'dark', title: 'Tenant consent not granted' },
] as const) {
  test(`redirect page shows ${outcome.title.toLowerCase()} with the saved appearance`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: outcome.system })
    await page.addInitScript((preference) => {
      localStorage.setItem('nuxt-color-mode', preference)
    }, outcome.preference)
    await page.goto(
      `/log-analytics-redirect.html?state=azure-argus-admin-consent&admin_consent=${outcome.granted}`,
    )

    await expect(page).toHaveTitle(outcome.title)
    await expect(page.getByRole('heading', { name: outcome.title })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Return to Azure Argus' })).toHaveAttribute(
      'href',
      '/logs',
    )
    expect(
      await page
        .locator('html')
        .evaluate(
          (element, preference) => element.classList.contains(preference),
          outcome.preference,
        ),
    ).toBe(true)
  })
}
