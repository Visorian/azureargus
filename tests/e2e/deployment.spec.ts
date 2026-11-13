import { expect, test } from '@playwright/test'

import { enterAnonymousMode, openSettings } from './support/logsWorkspace'

const eventHubOnlyDeploymentUrl =
  'https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy-event-hub-only.json'
const eventHubWithDiagnosticsDeploymentUrl =
  'https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy.json'
const LOGS_URL_PATTERN = /\/logs/
const LOGIN_URL_PATTERN = /\/login/
const DARK_CLASS_PATTERN = /dark/
const VISIBLE_RECEIVED_PATTERN = /visible \/ .*received/

test('anonymous deployment bypasses application login', async ({ page }) => {
  await page.goto('/login')

  await expect(page).toHaveURL(LOGS_URL_PATTERN, { timeout: 15_000 })
  await expect(page.getByText('Temporary session')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})

test('anonymous deployment starts directly in logs', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.goto('/logs')
  await expect(page).toHaveURL(LOGS_URL_PATTERN)
  await expect(page.getByText('Temporary session')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Azure Argus', exact: true })).toBeVisible()

  const darkModeToggle = page.getByRole('button', { name: 'Switch to dark mode' })
  await expect(darkModeToggle).toBeVisible()
  await darkModeToggle.click()
  await expect(page.locator('html')).toHaveClass(DARK_CLASS_PATTERN)
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible()

  await page.reload()
  await expect(page.locator('html')).toHaveClass(DARK_CLASS_PATTERN)
})

test('anonymous Event Hub settings expose both bounded deployment choices', async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 })
  await enterAnonymousMode(page)

  const settingsDrawer = await openSettings(page)
  const eventHubOnlyLink = settingsDrawer.getByRole('link', {
    name: 'Deploy Event Hub only to Azure (opens in new tab)',
  })
  const eventHubWithDiagnosticsLink = settingsDrawer.getByRole('link', {
    name: 'Deploy Event Hub and firewall diagnostics to Azure (opens in new tab)',
  })

  await expect(eventHubOnlyLink).toHaveAttribute('href', eventHubOnlyDeploymentUrl)
  await expect(eventHubWithDiagnosticsLink).toHaveAttribute(
    'href',
    eventHubWithDiagnosticsDeploymentUrl,
  )
  await expect(eventHubOnlyLink).toHaveAttribute('target', '_blank')
  await expect(eventHubWithDiagnosticsLink).toHaveAttribute('target', '_blank')
  await expect
    .poll(
      async () =>
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
    )
    .toBe(true)
})

test('managed deployment requires application login', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        mode: 'managed',
        eventHubAvailable: true,
        predefinedLogAnalyticsAvailable: false,
        temporaryLogAnalyticsAuthAvailable: false,
        errors: [],
      },
    })
  })

  await page.goto('/logs')
  await expect(page).toHaveURL(LOGIN_URL_PATTERN)
  await expect(page.getByRole('button', { name: 'Sign in with Entra' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use without login' })).toHaveCount(0)
})

test('anonymous delegated Log Analytics exposes temporary authentication controls', async ({
  page,
}) => {
  await page.route('**/api/capabilities', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        mode: 'anonymous',
        eventHubAvailable: false,
        predefinedLogAnalyticsAvailable: false,
        temporaryLogAnalyticsAuthAvailable: true,
        errors: [],
      },
    })
  })

  await page.goto('/logs')
  await page.getByRole('radio', { name: 'Log Analytics' }).click()
  const openLogAnalyticsSettings = page.getByRole('button', {
    name: 'Open Log Analytics settings',
  })
  await expect(openLogAnalyticsSettings).toBeVisible()
  await openLogAnalyticsSettings.click()
  const settingsDrawer = page.getByRole('dialog', { name: 'Settings', exact: true })
  await expect(settingsDrawer).toBeVisible()
  await expect(
    settingsDrawer.getByRole('heading', { name: 'Log Analytics settings' }),
  ).toBeVisible()
  await expect(page.getByText('Tenant ID', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Workspace ID', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Grant tenant consent' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Grant query permission' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Permissions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Connect to Azure' })).toBeEnabled()
  await settingsDrawer.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run query' })).toHaveAttribute(
    'aria-disabled',
    'true',
  )
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0)
})

test('anonymous mode can reach logs page', async ({ page }) => {
  await page.route('**/api/capabilities', async (route) => {
    await route.fulfill({
      contentType: 'application/json',
      json: {
        mode: 'anonymous',
        eventHubAvailable: true,
        predefinedLogAnalyticsAvailable: false,
        temporaryLogAnalyticsAuthAvailable: false,
        errors: [],
      },
    })
  })
  await enterAnonymousMode(page)

  const settingsButton = page.locator('#logs-settings-toggle')
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  const dataSource = page.getByRole('group', { name: 'Data source', exact: true })
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'false')
  await expect(settings).toBeHidden()
  await expect(dataSource.getByRole('radio', { name: 'Live Event Hub' })).toBeChecked()
  await expect(dataSource.getByRole('radio', { name: 'Log Analytics' })).toBeDisabled()
  await expect(dataSource.getByText(VISIBLE_RECEIVED_PATTERN)).toHaveCount(0)
  await expect(page.getByText(VISIBLE_RECEIVED_PATTERN)).toBeVisible()
  const searchLogs = page.getByRole('textbox', { name: 'Search logs' })
  await searchLogs.fill('dns')
  await expect
    .poll(
      async () =>
        await page.evaluate(() => ({
          horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          vertical: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
        })),
    )
    .toEqual({ horizontal: true, vertical: true })

  const liveSource = dataSource.getByRole('radio', { name: 'Live Event Hub' })
  await liveSource.focus()
  await liveSource.press('Space')
  await expect(liveSource).toBeChecked()

  const openEventHubSettings = page.getByRole('button', { name: 'Open Event Hub settings' })
  await openEventHubSettings.click()
  await expect(settingsButton).toHaveAttribute('aria-expanded', 'true')
  await expect(settings.getByRole('heading', { name: 'Live Event Hub settings' })).toBeVisible()
  await expect(settings.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(settings.locator(':focus')).toHaveCount(1)
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(openEventHubSettings).toBeFocused()
  await expect(searchLogs).toHaveValue('dns')

  await openSettings(page)
  const lookback = settings.getByRole('combobox', { name: 'Lookback' })
  await lookback.click()
  await expect(page.getByRole('option')).toHaveText([
    'Last 1 minute',
    'Last 3 minutes',
    'Last 5 minutes',
    'Last 10 minutes',
    'Last 15 minutes',
  ])
  await page.keyboard.press('Escape')
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(settings).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(settingsButton).toBeFocused()

  await openSettings(page)
  await expect(settings.getByRole('switch', { name: 'Local log retention' })).toBeVisible()
  await expect(
    settings.getByText('Keeps up to 100,000 parsed Live Event Hub records', { exact: false }),
  ).toBeVisible()
})

test('anonymous request cannot query Log Analytics', async ({ request }) => {
  const response = await request.post('/api/log-analytics/query', {
    data: {
      filters: {
        action: '',
        category: [],
        destination: '',
        protocol: '',
        search: '',
        source: '',
      },
      from: '2026-07-10T10:00:00.000Z',
      sort: { direction: 'desc', key: 'timestamp' },
      to: '2026-07-10T10:15:00.000Z',
    },
  })

  expect(response.status()).toBe(401)
})
