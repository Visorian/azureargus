import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'

import type { DnsEntry, DnsObservation } from '../../shared/types/dns'
import { mockManagedDeployment } from './support/deployment'
import {
  expectActiveResultVisible,
  expectResultsScrollAndNavigate,
  openSettings,
} from './support/logsWorkspace'

const EDIT_FILTERS_PATTERN = /Edit filters/
async function expectActiveDnsEntry(page: Page, row: Locator) {
  const results = page.getByRole('grid', { name: 'DNS results', exact: true })
  await expect(results).toBeFocused()
  await expect(async () => {
    await expect(results).toHaveAttribute('aria-activedescendant', (await row.getAttribute('id'))!)
  }).toPass()
}

async function expectAlignedColumns(header: Locator, row: Locator) {
  await expect(async () => {
    const [headerCells, rowCells] = await Promise.all([
      header.locator(':scope > *').evaluateAll((cells) =>
        cells.map((cell) => {
          const { width, x } = cell.getBoundingClientRect()
          return { width, x }
        }),
      ),
      row.locator(':scope > *').evaluateAll((cells) =>
        cells.map((cell) => {
          const { width, x } = cell.getBoundingClientRect()
          return { width, x }
        }),
      ),
    ])

    expect(rowCells).toHaveLength(headerCells.length)
    for (const [index, headerCell] of headerCells.entries()) {
      expect(Math.abs(rowCells[index]!.x - headerCell.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(rowCells[index]!.width - headerCell.width)).toBeLessThanOrEqual(1)
    }
  }).toPass()
}

async function expectNoHorizontalOverflow(cell: Locator) {
  await expect
    .poll(async () => await cell.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1)
}

test('managed DNS lens queries explicitly and shows decoded response size', async ({ page }) => {
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true })
  let readinessRequests = 0
  let listRequests = 0
  let detailRequests = 0
  let releaseDetail!: () => void
  const detailRelease = new Promise<void>((resolve) => {
    releaseDetail = resolve
  })
  const observation = {
    id: 'dns-query:proxy-structured:0',
    timestamp: '2026-07-12T14:30:00.000Z',
    source: 'proxy-structured',
    stage: 'proxy-exchange',
    path: 'proxy',
    outcome: 'response-unknown',
    resourceId:
      '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub',
    queryName: 'example.com.',
    queryId: '22213',
    queryType: 'AAAA',
    queryClass: 'IN',
    clientIp: 'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255',
    clientPort: '65535',
    protocol: 'UDP',
    requestSizeBytes: 57,
    responseSizeBytes: 300,
    responseCode: 'NOERROR',
    responseFlags: ['qr', 'rd', 'ra'],
    durationSeconds: 0.011877665,
    parseState: 'parsed',
    warnings: [],
    raw: { ResponseSize: 300 },
  } satisfies DnsObservation
  const selector = {
    source: 'proxy-structured',
    resourceId: observation.resourceId,
    timestamp: observation.timestamp,
    queryId: observation.queryId,
    queryName: observation.queryName,
    clientIp: observation.clientIp,
    clientPort: observation.clientPort,
  }
  const transportObservation = {
    id: 'dns-transport:network-rule:0',
    timestamp: '2026-07-12T14:29:00.000Z',
    logAnalyticsStorage: 'azure-diagnostics',
    source: 'network-rule',
    stage: 'transport',
    path: 'direct',
    outcome: 'transport-observed',
    clientIp: 'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.254',
    clientPort: '65535',
    serverIp: '168.63.129.16',
    serverPort: '53',
    protocol: 'UDP',
    responseFlags: [],
    parseState: 'parsed',
    warnings: [],
    raw: {},
  } satisfies DnsObservation

  await page.route('**/api/log-analytics/dns/readiness', async (route) => {
    readinessRequests += 1
    await route.fulfill({
      contentType: 'application/json',
      json: {
        readiness: [
          {
            source: 'proxy-structured',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'proxy-structured',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'dns-flow-trace',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'dns-flow-trace',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'internal-fqdn-failure',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'internal-fqdn-failure',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'network-rule',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'network-rule',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'application-rule',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'application-rule',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'flow-trace',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'flow-trace',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'nat-rule',
            storage: 'resource-specific',
            status: 'success',
            sampleCount: 2,
          },
          {
            source: 'nat-rule',
            storage: 'azure-diagnostics',
            status: 'success',
            sampleCount: 2,
          },
        ],
      },
    })
  })

  await page.route('**/api/log-analytics/dns/list', async (route) => {
    listRequests += 1
    const partialResult = listRequests === 1
    const requestBody: unknown = route.request().postDataJSON()
    expect(requestBody).not.toHaveProperty('workspaceId')
    expect(requestBody).toMatchObject({
      filters: {
        search: '',
        queryType: '',
        client: '',
        protocol: '',
        outcome: '',
        source: '',
      },
      limit: 1_000,
      storage: 'resource-specific',
    })
    await route.fulfill({
      contentType: 'application/json',
      json: {
        queriedEntries: [
          {
            id: 'dns-query:proxy-structured:0',
            timestamp: observation.timestamp,
            queryName: observation.queryName,
            queryType: observation.queryType,
            client: `${observation.clientIp}:${observation.clientPort}`,
            protocol: observation.protocol,
            path: observation.path,
            outcome: observation.outcome,
            durationSeconds: observation.durationSeconds,
            observationCount: 1,
            completeness: 'complete',
            confidence: 'uncorrelated',
            source: observation.source,
            warnings: [],
            observations: [observation],
            detailSelector: selector,
          },
          {
            id: 'dns-query:proxy-structured:1',
            timestamp: '2026-07-12T14:20:00.000Z',
            queryName: 'older.example.com.',
            queryType: 'A',
            client: '10.0.0.4:53000',
            protocol: 'UDP',
            path: 'proxy',
            outcome: 'response-unknown',
            durationSeconds: 0.02,
            observationCount: 1,
            completeness: 'complete',
            confidence: 'uncorrelated',
            source: 'proxy-structured',
            warnings: [],
            observations: [],
          },
        ],
        transportObservations: partialResult ? [] : [transportObservation],
        queriedEntriesTruncated: false,
        transportObservationsTruncated: false,
        sources: partialResult
          ? [
              { source: 'proxy-structured', availability: 'available', truncated: false },
              { source: 'dns-flow-trace', availability: 'available', truncated: false },
              { source: 'internal-fqdn-failure', availability: 'available', truncated: false },
              {
                source: 'network-rule',
                availability: 'failed',
                truncated: false,
                warning: 'DNS transport query failed',
              },
            ]
          : [
              { source: 'proxy-structured', availability: 'available', truncated: false },
              { source: 'dns-flow-trace', availability: 'available', truncated: false },
              { source: 'internal-fqdn-failure', availability: 'available', truncated: false },
              { source: 'network-rule', availability: 'available', truncated: false },
            ],
      },
    })
  })
  await page.route('**/api/log-analytics/dns/detail', async (route) => {
    detailRequests += 1
    expect(route.request().postDataJSON()).toEqual({ selector })
    await detailRelease
    await route.fulfill({
      contentType: 'application/json',
      json: {
        observations: [observation],
        detailTruncated: false,
        completeness: 'complete',
        warnings: [],
      },
    })
  })

  await page.goto('/logs')
  await expect.poll(() => readinessRequests, { timeout: 15_000 }).toBe(1)
  expect(listRequests).toBe(0)
  await page.getByRole('radio', { name: 'DNS troubleshooting', exact: true }).check()
  await expect(page.getByText('Run DNS query to load entries.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Apply filters' })).toHaveCount(0)
  const resultFilter = page.getByRole('combobox', { name: 'DNS result', exact: true })
  await resultFilter.click()
  await expect(page.getByRole('option', { name: 'Response received' })).toBeVisible()
  await expect(page.getByRole('option', { name: 'Transport observed' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect.poll(() => listRequests).toBe(1)
  await expect(page.getByText('DNS transport query failed', { exact: false })).toBeVisible()
  const entryRows = page.locator('[data-dns-entry]')
  await expect(entryRows).toHaveCount(2)
  const entryHeader = page.getByTestId('dns-entry-header')
  const entryRow = page.locator('[data-dns-entry="dns-query:proxy-structured:0"]')
  await expectAlignedColumns(entryHeader, entryRow)
  await expectNoHorizontalOverflow(page.locator('.dns-scroller'))
  await page
    .getByRole('textbox', { name: 'Domain or DNS search', exact: true })
    .fill('not-in-results')
  await expect(entryRows).toHaveCount(2)
  await expect(page.getByText('Changes not applied.', { exact: true })).toBeVisible()
  expect(listRequests).toBe(1)
  await page.getByRole('textbox', { name: 'Domain or DNS search', exact: true }).fill('')
  await entryRow.focus()
  await page.keyboard.press('ArrowDown')
  await expectActiveDnsEntry(page, page.locator('[data-dns-entry="dns-query:proxy-structured:1"]'))
  await page.keyboard.press('ArrowUp')
  await expectActiveDnsEntry(page, entryRow)

  const settingsDrawer = await openSettings(page)
  const sourceSelect = settingsDrawer.getByRole('combobox', { name: 'Query source' })
  await sourceSelect.click()
  await page.getByRole('option', { name: 'AzureDiagnostics', exact: true }).click()
  await expect(page.getByText('Run DNS query to load entries.')).toBeVisible()
  await sourceSelect.click()
  await page.getByRole('option', { name: 'Dedicated tables', exact: true }).click()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  await expect.poll(() => listRequests).toBe(2)
  await page.getByRole('checkbox', { name: 'Show unidentified DNS transport' }).check()
  const transportRow = page.locator('[data-dns-entry="dns-transport:network-rule:0"]')
  await expect(transportRow).toBeVisible()
  await expectAlignedColumns(entryHeader, transportRow)
  await expect(transportRow).toContainText('Partial')
  await expect(page.getByText('Result incomplete', { exact: true })).toHaveCount(0)
  const sortOrder = page.getByRole('combobox', { name: 'DNS sort order' })
  await sortOrder.click()
  await page.getByRole('option', { name: 'Oldest first' }).click()
  await expect(entryRows.first()).toHaveAttribute('data-dns-entry', 'dns-query:proxy-structured:1')
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: EDIT_FILTERS_PATTERN })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Domain or DNS search' })).toBeHidden()
  await expectNoHorizontalOverflow(transportRow)
  await transportRow.click()
  const transportDetail = page.getByRole('dialog', { name: 'DNS transport detail' })
  await expect(transportDetail).toBeVisible()
  await expect(transportDetail.getByText('168.63.129.16:53', { exact: true }).first()).toBeVisible()
  expect(detailRequests).toBe(0)
  await page.keyboard.press('Escape')
  await expectActiveDnsEntry(page, transportRow)
  await entryRow.click()
  const resolutionDetail = page.getByRole('dialog', { name: 'DNS resolution detail' })
  await expect(resolutionDetail).toBeVisible()
  await expect(resolutionDetail.getByText('Loading DNS observations…')).toBeVisible()
  releaseDetail()
  await expect(resolutionDetail.getByText('300 bytes, not TTL')).toBeVisible()
  await expect(resolutionDetail.getByRole('button', { name: 'Copy raw' })).toBeVisible()
  await expect(resolutionDetail.locator('pre[aria-label="Raw message"]')).toHaveText(
    JSON.stringify(observation.raw, null, 2),
  )
  await expect.poll(() => detailRequests).toBe(1)
  expect(
    await resolutionDetail
      .locator('.app-field-list')
      .first()
      .evaluate((element) => getComputedStyle(element).userSelect),
  ).not.toBe('none')
  await page.keyboard.press('Escape')
  await expectActiveDnsEntry(page, entryRow)

  const manyEntries = Array.from({ length: 600 }, (_, index) => {
    const timestamp = new Date(Date.parse(observation.timestamp) - index * 1_000).toISOString()
    const queryName = `record-${index}.example.`
    return {
      id: `bulk-${index}`,
      timestamp,
      queryName,
      queryType: observation.queryType,
      client: '10.0.0.4:53000',
      protocol: observation.protocol,
      path: observation.path,
      outcome: observation.outcome,
      observationCount: 1,
      completeness: 'complete',
      confidence: 'uncorrelated',
      source: observation.source,
      warnings: [],
      observations: [{ ...observation, id: `bulk-observation-${index}`, timestamp, queryName }],
    } satisfies DnsEntry
  })
  await page.route('**/api/log-analytics/dns/list', async (route) => {
    await route.fulfill({
      json: {
        queriedEntries: manyEntries,
        transportObservations: [],
        queriedEntriesTruncated: false,
        transportObservationsTruncated: false,
        sources: [],
      },
    })
  })
  await page.setViewportSize({ width: 1280, height: 900 })
  await sortOrder.click()
  await page.getByRole('option', { name: 'Newest first', exact: true }).click()
  await page.getByRole('button', { name: 'Run query', exact: true }).click()
  const firstBulkRow = page.locator('[data-dns-entry="bulk-0"]')
  const lastBulkRow = page.locator('[data-dns-entry="bulk-599"]')
  await expect(firstBulkRow).toBeVisible()
  expect(await page.locator('[data-dns-entry]').count()).toBeLessThan(manyEntries.length)
  await firstBulkRow.focus()
  await page.keyboard.press('End')
  await expectActiveDnsEntry(page, lastBulkRow)
  await expectActiveResultVisible(page.getByRole('grid', { name: 'DNS results', exact: true }))
  await page.keyboard.press('Enter')
  await expect(
    page
      .getByRole('dialog', { name: 'DNS resolution detail' })
      .getByText('record-599.example.', { exact: true })
      .first(),
  ).toBeVisible()
  await page.keyboard.press('Escape')
  await expectActiveDnsEntry(page, lastBulkRow)
  await page.keyboard.press('Home')
  await expectActiveDnsEntry(page, firstBulkRow)
  const viewport = page.locator('.dns-scroller')
  await viewport.hover()
  await page.mouse.wheel(0, 1000)
  await expect.poll(async () => await viewport.evaluate((el) => el.scrollTop)).toBeGreaterThan(800)
  await expect(page.getByRole('grid', { name: 'DNS results', exact: true })).toBeFocused()
  await expectActiveResultVisible(page.getByRole('grid', { name: 'DNS results', exact: true }))
  await page.keyboard.press('PageDown')
  await page.keyboard.press('PageDown')
  await page.keyboard.press('PageUp')
  const results = page.getByRole('grid', { name: 'DNS results', exact: true })
  await expect(results).toBeFocused()
  await expectActiveResultVisible(results)
  await expectResultsScrollAndNavigate(page, results, 375)
  await expectResultsScrollAndNavigate(page, results, 768)
})
