import { setTimeout as delay } from 'node:timers/promises'

import { expect, test } from '@playwright/test'

import { mockManagedDeployment } from './support/deployment'

const SIMULATOR_URL = /\/firewall-simulator$/u
const LOGS_URL = /\/logs$/u

test('a managed hard load keeps the requested page and displays the session identity', async ({
  page,
}) => {
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true })
  await page.route('**/api/_auth/session', async (route) => {
    await delay(150)
    await route.fulfill({
      json: {
        provider: 'entra',
        canRefresh: false,
        expireAt: Math.floor(Date.now() / 1000) + 3600,
        userName: 'architect@example.com',
      },
    })
  })

  await page.goto('/firewall-simulator')

  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(page.getByText('architect@example.com', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in with Entra' })).toHaveCount(0)
  await expect(page).toHaveURL(SIMULATOR_URL)

  await page.addInitScript(() => {
    new MutationObserver(() => {
      if (
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent.trim() === 'Sign in with Entra',
        )
      ) {
        document.documentElement.dataset['signInShown'] = 'true'
      }
    }).observe(document, { childList: true, subtree: true })
  })
  await page.goto('/login')
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible()
  await expect(page).toHaveURL(LOGS_URL)
  expect(await page.locator('html').getAttribute('data-sign-in-shown')).toBeNull()
})

test('sign-in stays pending after the authentication navigation starts', async ({ page }) => {
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true })
  await page.route('**/api/_auth/session', async (route) => {
    await route.fulfill({ json: {} })
  })
  await page.route('**/auth/entra/login', async (route) => {
    await route.fulfill({ status: 204 })
  })
  await page.goto('/login')
  const signIn = page.getByRole('button', { name: 'Sign in with Entra' })
  const started = page.waitForResponse('**/auth/entra/login')

  await signIn.click()
  await started
  await page.waitForLoadState('networkidle')

  await expect(signIn).toBeDisabled()
  await expect(signIn).toBeFocused()
})

test('configuration checking, failed retry and recovery retain usable feedback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 })
  let releaseInitial: (() => void) | undefined
  const initial = new Promise<void>((resolve) => {
    releaseInitial = resolve
  })
  let releaseRetry: (() => void) | undefined
  const retryResponse = new Promise<void>((resolve) => {
    releaseRetry = resolve
  })
  let holdRetry = false
  let valid = false
  let first = true
  await page.route('**/api/capabilities', async (route) => {
    if (first) {
      first = false
      await initial
    } else if (holdRetry) {
      await retryResponse
    }
    await route.fulfill({
      json: valid
        ? {
            mode: 'anonymous',
            eventHubAvailable: false,
            predefinedLogAnalyticsAvailable: false,
            temporaryLogAnalyticsAuthAvailable: false,
            errors: [],
          }
        : {
            mode: 'invalid',
            eventHubAvailable: false,
            predefinedLogAnalyticsAvailable: false,
            temporaryLogAnalyticsAuthAvailable: false,
            errors: [
              {
                code: 'oidc_incomplete',
                message: 'NUXT_OIDC_PROVIDERS_ENTRA_AUTHORIZATION_URL must be configured.',
              },
            ],
          },
    })
  })

  await page.goto('/configuration-error')
  await expect(
    page.getByRole('heading', { name: 'Checking deployment configuration' }),
  ).toBeVisible()
  releaseInitial?.()
  await expect(page.getByRole('listitem')).toHaveText(
    'NUXT_OIDC_PROVIDERS_ENTRA_AUTHORIZATION_URL must be configured.',
  )
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  )
  const retry = page.getByRole('button', { name: 'Retry' })
  holdRetry = true
  await retry.click()
  await expect(retry).toHaveAttribute('aria-busy', 'true')
  await expect(retry).toBeFocused()
  await expect(
    page.getByRole('heading', { name: 'Deployment configuration unavailable' }),
  ).toBeVisible()
  await expect(page.getByRole('listitem')).toHaveText(
    'NUXT_OIDC_PROVIDERS_ENTRA_AUTHORIZATION_URL must be configured.',
  )
  holdRetry = false
  releaseRetry?.()
  await expect(page.getByRole('status')).toHaveText(
    'Configuration is still unavailable. Check the deployment settings and retry.',
  )
  await expect(retry).toBeFocused()

  valid = true
  await retry.click()
  await expect(page).toHaveURL(LOGS_URL)
})

test('valid configuration direct visits recover and unknown routes use the application shell', async ({
  page,
}) => {
  await page.goto('/configuration-error')
  await expect(page).toHaveURL(LOGS_URL)
  await page.goto('/missing-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
  await page.getByRole('button', { name: 'Open logs' }).click()
  await expect(page).toHaveURL(LOGS_URL)
})
