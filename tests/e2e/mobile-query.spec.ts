import { expect, test } from '@playwright/test'

import type { LogAnalyticsQueryResponse } from '../../shared/types/logAnalytics'
import { mockManagedDeployment } from './support/deployment'

const EDIT_FILTERS = /^Edit filters/u
const HIDE_FILTERS = /^Hide filters/u

test.use({ timezoneId: 'Europe/Berlin' })
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true })
  await page.route('**/api/log-analytics/dns/readiness', async (route) => {
    await route.fulfill({ json: { readiness: [] } })
  })
})
const result: LogAnalyticsQueryResponse = {
  limit: 1_000,
  truncated: false,
  records: [
    {
      id: 'query-result',
      timestamp: '2026-07-21T15:30:00.000Z',
      category: 'AZFWNetworkRule',
      action: 'Allow',
      protocol: 'TCP',
      sourceIp: '10.0.0.4',
      destinationIp: '10.0.0.5',
      message: 'Allowed internal traffic',
      raw: {},
      searchableText: 'allow tcp internal traffic',
    },
  ],
}

test('mobile historical filters collapse on Run and preserve a draft edited in flight', async ({
  page,
}) => {
  const requests: unknown[] = []
  const pending = Promise.withResolvers<boolean>()
  await page.route('**/api/log-analytics/query', async (route) => {
    requests.push(route.request().postDataJSON())
    if (requests.length === 1) {
      await pending.promise
    }
    await route.fulfill({ json: result })
  })
  try {
    await page.goto('/logs')
    const edit = page.getByRole('button', { name: EDIT_FILTERS })
    const run = page.getByRole('button', { name: 'Run query', exact: true })
    await expect(page.getByRole('textbox', { name: 'Source address', exact: true })).toBeHidden()
    await edit.click()
    await page.locator('.filter-range-trigger').click()
    await page.getByRole('textbox', { name: 'Start (UTC)' }).fill('2026-07-21T15:00')
    await page.getByRole('textbox', { name: 'End (UTC)' }).fill('2026-07-21T16:00')
    await page.getByRole('textbox', { name: 'Source address', exact: true }).fill('10.0.0.4')
    await run.click()
    await expect(run).toHaveAttribute('aria-busy', 'true')
    await expect(run).toBeFocused()
    await expect(page.getByRole('textbox', { name: 'Source address', exact: true })).toBeHidden()
    await run.click({ force: true })
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      from: '2026-07-21T15:00:00.000Z',
      to: '2026-07-21T16:00:00.000Z',
      filters: { source: '10.0.0.4' },
    })
    await edit.click()
    await page.getByRole('textbox', { name: 'Source address', exact: true }).fill('10.0.0.9')
    pending.resolve(true)
    await expect(run).toHaveAttribute('aria-busy', 'false')
    await expect(page.getByRole('textbox', { name: 'Source address', exact: true })).toHaveValue(
      '10.0.0.9',
    )
    await page.getByRole('button', { name: HIDE_FILTERS }).click()
    await expect(page.getByText('Changes not applied.', { exact: true })).toBeVisible()
    await expect(page.locator('.connection-overview')).toContainText('Applied · 10.0.0.4 → Any')
    await expect(page.getByTestId('mobile-log-list').getByRole('button')).toHaveCount(1)
    await run.click()
    await expect.poll(() => requests.length).toBe(2)
    await expect(page.locator('.connection-overview')).toContainText('Applied · 10.0.0.9 → Any')
  } finally {
    pending.resolve(true)
  }
})

test('mobile range errors stay visible while collapsed and previous results survive failures', async ({
  page,
}) => {
  let requests = 0
  await page.route('**/api/log-analytics/query', async (route) => {
    requests += 1
    if (requests === 1) {
      await route.fulfill({ json: result })
    } else {
      await route.fulfill({ status: 502, json: { message: 'Workspace is unavailable.' } })
    }
  })
  await page.goto('/logs')
  const run = page.getByRole('button', { name: 'Run query', exact: true })
  await run.click()
  await expect(page.getByTestId('mobile-log-list').getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: EDIT_FILTERS }).click()
  await page.getByRole('textbox', { name: 'Search logs' }).fill('new draft')
  await page.getByRole('button', { name: HIDE_FILTERS }).click()
  await expect(page.getByTestId('mobile-log-list').getByRole('button')).toHaveCount(1)
  expect(requests).toBe(1)
  await run.click()
  await expect(page.getByRole('alert')).toContainText(
    'Last query failed. Showing previous results. Workspace is unavailable.',
  )
  await expect(page.getByTestId('mobile-log-list').getByRole('button')).toHaveCount(1)
  await page.getByRole('button', { name: EDIT_FILTERS }).click()
  await page.locator('.filter-range-trigger').click()
  await page.getByRole('textbox', { name: 'Start (UTC)' }).fill('2026-07-21T16:00')
  await page.getByRole('textbox', { name: 'End (UTC)' }).fill('2026-07-21T15:00')
  await page.getByRole('button', { name: HIDE_FILTERS }).click()
  await expect(page.getByRole('alert')).toContainText('Start date must be before end date.')
  await expect(run).toHaveAttribute('aria-disabled', 'true')
  const completedRequests = requests
  await run.click({ force: true })
  expect(requests).toBe(completedRequests)
})
