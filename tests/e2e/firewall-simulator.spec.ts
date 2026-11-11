import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import { FIREWALL_SIMULATOR_EXAMPLE } from '../../app/utils/firewallSimulatorExample'
import type { FirewallJsonObject } from '../../shared/types/firewallSimulator'
import { mockTemporaryAzure } from './support/temporaryAzure'

const LINE_BREAKS = /[\r\n]/u

const policyScope =
  '/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/example/providers/Microsoft.Network/firewallPolicies'

function resourceId(resource: FirewallJsonObject): string {
  if (typeof resource['id'] !== 'string') {
    throw new TypeError('Expected fixture resource ID')
  }
  return resource['id']
}

async function fillImportedConnection(page: Page) {
  const source = page.getByLabel('Source IPv4 address', { exact: true })
  const destination = page.getByLabel('Destination IPv4 address', { exact: true })
  await expect(source).toHaveValue('')
  await expect(destination).toHaveValue('')
  await source.fill('10.20.0.10')
  await destination.fill('10.30.0.4')
}

test('traces the selected child policy and clears stale decisions when the connection changes', async ({
  page,
}) => {
  await page.goto('/logs')
  const simulatorLink = page.getByRole('link', { name: 'Rule simulator', exact: true })
  await simulatorLink.click()
  await expect(simulatorLink).toHaveAttribute('aria-current', 'page')
  await page.getByRole('button', { name: 'Use example' }).click()
  await expect(page.getByLabel('Effective processing order')).toBeVisible()
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  const result = page.getByRole('status')
  await expect(result.getByRole('heading', { name: 'Allow by configured rules' })).toBeVisible()
  await expect(result).toContainText('private-https / allow-private-service')
  await expect(result).toBeInViewport({ ratio: 0.99 })
  await expect(
    page
      .getByLabel('Network collections', { exact: true })
      .getByText('IP group workload-clients: 10.20.0.0/24', { exact: true }),
  ).toBeVisible()

  await page.getByLabel('Find a collection or rule', { exact: true }).fill('not-a-collection')
  await page.getByRole('button', { name: 'Inspect evaluation', exact: true }).click()
  await expect(page.getByLabel('Find a collection or rule', { exact: true })).toHaveValue('')
  await expect(page.locator('summary').filter({ hasText: 'private-https' })).toBeFocused()

  await page.getByLabel('Destination IPv4 address').fill('198.51.100.9')
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(result.getByRole('heading', { name: 'Deny (default)', exact: true })).toBeVisible()
  await expect(result).toContainText('Application rules were not evaluated')
  await expect(page.locator('summary').filter({ hasText: 'public-https' })).toContainText('Skipped')
  await page.getByLabel('Application protocol', { exact: true }).click()
  await page.getByRole('option', { name: 'HTTPS', exact: true }).click()
  const host = page.getByLabel('Host / SNI', { exact: true })
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(host).toBeFocused()
  await expect(host).toHaveAttribute('aria-invalid', 'true')
  await expect(result).toHaveCount(0)
  await host.fill('api.example.com')
  await expect(host).not.toHaveAttribute('aria-invalid', 'true')
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(result).toContainText('public-https / allow-example-subdomains')
  await expect(
    page
      .locator('details[data-collection-id]')
      .filter({ has: page.getByText('private-https', { exact: true }) }),
  ).toHaveJSProperty('open', false)

  await page.getByLabel('Host / SNI', { exact: true }).fill('github.com')
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(result.getByRole('heading', { name: 'Indeterminate', exact: true })).toBeVisible()
  await expect(result).toContainText('built-in infrastructure collection')
  await result.getByRole('button', { name: 'Inspect evaluation', exact: true }).click()
  const afterCollections = page.locator('summary').filter({
    hasText: 'After collections: infrastructure and default deny',
  })
  await expect(afterCollections).toBeFocused()
  await expect(afterCollections.locator('..')).toHaveJSProperty('open', true)

  await page.getByLabel('Application protocol', { exact: true }).click()
  await page.getByRole('option', { name: 'None', exact: true }).click()
  await expect(page.getByLabel('Host / SNI', { exact: true })).toHaveCount(0)
  await page.getByLabel('Destination IPv4 address').fill('10.30.0.4')

  await page.getByLabel('Evaluate policy').click()
  await page.getByRole('option', { name: 'restricted-workload', exact: true }).click()
  await expect(result).toHaveCount(0)
  await expect(
    page.getByLabel('Effective processing order').getByText('private-https', { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(result.getByRole('heading', { name: 'Deny by configured rules' })).toBeVisible()
  await page.getByLabel('Destination IPv4 address').fill('10.30.0.5')
  await expect(result).toHaveCount(0)
  await expect(
    page.getByText('Connection or policy changed. Simulate again to update the result.'),
  ).toBeVisible()
  await page.getByLabel('IP protocol', { exact: true }).click()
  await page.getByRole('option', { name: 'ICMP', exact: true }).click()
  const port = page.getByLabel('Destination port', { exact: true })
  await expect(port).toBeDisabled()
  await expect(port).toHaveValue('')
  await expect(
    page.getByText('Choose HTTP, HTTPS, or MSSQL to evaluate application hostname rules.'),
  ).toHaveCount(0)
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(result.getByRole('heading', { name: 'Deny (default)', exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('button', { name: 'Simulate connection' })).toBeVisible()
  expect(
    await page
      .locator('.firewall-simulator')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  const dimensions = await page.evaluate(() => ({
    page: document.scrollingElement?.scrollHeight,
    viewport: window.innerHeight,
  }))
  expect(dimensions.page, 'The app must scroll inside its shell').toBeLessThanOrEqual(
    dimensions.viewport,
  )
  await result.getByRole('button', { name: 'Inspect evaluation', exact: true }).click()
  await expect(afterCollections).toBeFocused()
  await expect(page.getByRole('banner')).toBeInViewport({ ratio: 0.99 })

  await page.getByLabel('IP protocol', { exact: true }).click()
  await page.getByRole('option', { name: 'TCP', exact: true }).click()
  await port.fill('65536')
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(port).toBeFocused()
  await expect(port).toHaveAttribute('aria-invalid', 'true')
  await port.fill('443')
  const source = page.getByLabel('Source IPv4 address', { exact: true })
  await source.fill('10.20.0.0/24')
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(source).toBeFocused()
  await expect(source).toHaveAttribute('aria-invalid', 'true')
  await expect(
    page.getByText('Ranges are not supported as connection inputs.', { exact: false }),
  ).toBeVisible()
})

test('imports pasted JSON and multiple files, retains the loaded policy after invalid input, and downloads a reusable snapshot', async ({
  page,
}) => {
  await page.goto('/firewall-simulator')
  await page.getByRole('button', { name: 'Use example', exact: true }).click()
  await page.getByRole('button', { name: 'Change configuration', exact: true }).click()
  await expect(page.getByLabel('Configuration text', { exact: true })).toHaveValue('')
  await page
    .getByLabel('Configuration text', { exact: true })
    .fill(JSON.stringify(FIREWALL_SIMULATOR_EXAMPLE))
  await page.getByRole('button', { name: 'Load configuration', exact: true }).click()
  await expect(page.getByLabel('Effective processing order')).toBeVisible()
  await fillImportedConnection(page)
  await page.getByRole('button', { name: 'Change configuration', exact: true }).click()
  await page.getByLabel('Configuration text', { exact: true }).fill('not JSON')
  await page.getByRole('button', { name: 'Load configuration', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Expected JSON')
  await expect(page.getByLabel('Effective processing order')).toContainText('private-https')

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download snapshot', exact: true }).click()
  const download = await downloadPromise
  const stream = await download.createReadStream()
  const buffers: Buffer[] = []
  for await (const chunk of stream) {
    const value: unknown = chunk
    if (!(value instanceof Uint8Array)) {
      throw new Error('Expected binary download content')
    }
    buffers.push(Buffer.from(value))
  }
  await page.getByLabel('Upload JSON files', { exact: true }).setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.concat(buffers),
  })
  await expect(page.getByText('firewall-configuration.json', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await fillImportedConnection(page)
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(page.getByRole('status')).toContainText('private-https / allow-private-service')

  await page.getByRole('button', { name: 'Change configuration', exact: true }).click()
  await page.getByLabel('Upload JSON files', { exact: true }).setInputFiles(
    FIREWALL_SIMULATOR_EXAMPLE.resources.map((resource, index) => ({
      name: `resource-${index}.json`,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(resource)),
    })),
  )
  await expect(page.getByText('resource-0.json', { exact: false })).toBeVisible()
  await expect(page.getByLabel('Effective processing order')).toContainText('private-https')
  await expect(page.getByRole('status')).toHaveCount(0)
  await fillImportedConnection(page)

  await page.getByRole('button', { name: 'Change configuration', exact: true }).click()
  const original = JSON.stringify(FIREWALL_SIMULATOR_EXAMPLE)
  const anotherGroup = original.replaceAll(
    '/resourceGroups/example/',
    '/resourceGroups/other-network/',
  )
  await page.getByLabel('Configuration text', { exact: true }).fill(`[${original},${anotherGroup}]`)
  await page.getByRole('button', { name: 'Load configuration', exact: true }).click()
  await fillImportedConnection(page)
  await page.getByLabel('Evaluate policy', { exact: true }).click()
  const duplicatePolicies = page.getByRole('option').filter({ hasText: 'workload' })
  await expect(duplicatePolicies.filter({ hasText: 'example,' })).toHaveCount(2)
  await expect(duplicatePolicies.filter({ hasText: 'other-network,' })).toHaveCount(2)
  await page.keyboard.press('Escape')

  await page.getByRole('button', { name: 'Change configuration', exact: true }).click()
  await page.getByLabel('Configuration text', { exact: true }).fill(
    JSON.stringify({
      resources: FIREWALL_SIMULATOR_EXAMPLE.resources.filter(
        (resource) => resource['type'] !== 'Microsoft.Network/ipGroups',
      ),
    }),
  )
  await page.getByRole('button', { name: 'Load configuration', exact: true }).click()
  const missingGroups = page.getByRole('region', {
    name: 'Configuration is incomplete',
    exact: true,
  })
  await expect(missingGroups).toContainText('workload-clients')
  await expect(missingGroups).toContainText('private-services')
  await fillImportedConnection(page)
  await page.getByRole('button', { name: 'Simulate connection', exact: true }).click()
  const unresolvedResult = page.getByRole('status')
  await expect(unresolvedResult).toContainText('private-https / allow-private-service')
  await expect(unresolvedResult).toContainText('workload-clients')
  await expect(unresolvedResult.getByRole('button', { name: 'Inspect evaluation' })).toBeVisible()
  await unresolvedResult.getByRole('button', { name: 'Inspect evaluation' }).click()
  await expect(page.locator('summary').filter({ hasText: 'private-https' })).toContainText(
    'Unresolved',
  )
  await page.setViewportSize({ width: 390, height: 844 })
  const scroller = await page.locator('.firewall-simulator').evaluate((element) => ({
    contentWidth: element.scrollWidth,
    visibleWidth: element.clientWidth,
  }))
  expect(
    scroller.contentWidth,
    'Expanded missing-group details must fit the simulator',
  ).toBeLessThanOrEqual(scroller.visibleWidth)
  await unresolvedResult.getByRole('button', { name: 'Review configuration' }).click()
  await expect(page.getByRole('button', { name: 'Upload JSON files', exact: true })).toBeFocused()

  await page.getByLabel('Configuration text', { exact: true }).fill(
    JSON.stringify({
      id: `${policyScope}/p1`,
      name: 'p1',
      type: 'Microsoft.Network/firewallPolicies',
      properties: {},
    }),
  )
  await page.getByRole('button', { name: 'Load configuration', exact: true }).click()
  const incomplete = page.getByRole('region', { name: 'Configuration is incomplete', exact: true })
  await expect(incomplete).toBeVisible()
  await expect(incomplete).toContainText('Collection groups for p1 are incomplete.')
  await fillImportedConnection(page)
  await page.getByRole('button', { name: 'Simulate connection', exact: true }).click()
  const result = page.getByRole('status')
  await expect(result.getByRole('heading', { name: 'Indeterminate', exact: true })).toBeVisible()
  await expect(result).toContainText('Collection groups for p1 are incomplete.')
  await result.getByRole('button', { name: 'Review configuration', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Upload JSON files', exact: true })).toBeFocused()
})

test('loads a live policy chain through Azure sign-in and resolves IP groups in the rendered trace', async ({
  page,
}) => {
  await mockTemporaryAzure(page)
  const resources = new Map(
    FIREWALL_SIMULATOR_EXAMPLE.resources.map((resource) => [
      resourceId(resource).toLowerCase(),
      resource,
    ]),
  )
  const readPaths: string[] = []
  await page.route('https://management.azure.com/**', async (route) => {
    const request = route.request()
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-allow-methods': 'GET, OPTIONS',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers })
      return
    }
    expect(request.method()).toBe('GET')
    expect(request.headers()['authorization']).toBe('Bearer temporary-management-token')
    const path = new URL(request.url()).pathname.toLowerCase()
    readPaths.push(path)
    if (path.endsWith('/rulecollectiongroups')) {
      const groups = [...resources.values()].filter((resource) =>
        resourceId(resource).toLowerCase().startsWith(`${path}/`),
      )
      await route.fulfill({ headers, json: { value: groups } })
      return
    }
    const resource = resources.get(path)
    expect(resource).toBeDefined()
    await route.fulfill({ headers, json: resource })
  })
  await page.goto('/firewall-simulator')
  await page.getByRole('button', { name: 'Live Azure', exact: true }).click()
  await page.getByRole('button', { name: 'Connect to Azure', exact: true }).click()
  await expect(page.getByText('temporary@example.com', { exact: true })).toBeVisible()
  await page
    .getByLabel('Policy or firewall resource IDs', { exact: true })
    .fill(`${policyScope}/workload`)
  await page.getByRole('button', { name: 'Read Azure configuration', exact: true }).click()
  await expect(page.getByLabel('Effective processing order')).toContainText('block-ssh')
  await fillImportedConnection(page)
  await page.getByRole('button', { name: 'Simulate connection' }).click()
  await expect(page.getByRole('status')).toContainText('private-https / allow-private-service')
  expect(readPaths).toContain(`${policyScope}/organization`.toLowerCase())
  expect(readPaths.filter((path) => path.includes('/ipgroups/'))).toHaveLength(2)
})

test('configures and copies readable Cloud Shell commands from an accessible modal', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/firewall-simulator')
  const trigger = page.getByRole('button', { name: 'Get export command', exact: true })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: 'Export Azure Firewall configuration' })
  await expect(dialog).toBeVisible()
  const environment = dialog.getByLabel('Cloud Shell environment', { exact: true })
  await expect(environment).toContainText('Azure CLI in Bash')
  const command = dialog.getByLabel('Export command', { exact: true })
  const copy = dialog.getByRole('button', { name: 'Copy command', exact: true })
  await expect(copy).toBeDisabled()
  await expect(command).toHaveCount(0)
  await expect(
    dialog.getByText('Enter a firewall or policy name to generate the command.', { exact: true }),
  ).toBeVisible()
  await dialog.getByLabel('Subscription', { exact: true }).fill('demo')
  await dialog.getByLabel('Resource group', { exact: true }).fill('network')
  const firewall = dialog.getByLabel('Firewall name', { exact: true })
  const policy = dialog.getByLabel('Policy name', { exact: true })
  await firewall.fill('hub-firewall')
  await expect(copy).toBeEnabled()
  await policy.fill('workload-policy')
  await dialog.getByRole('radio', { name: 'Text to paste', exact: true }).check()
  const bash = await command.inputValue()
  expect(bash).toContain('hub-firewall')
  expect(bash).toContain('workload-policy')
  await environment.click()
  await page.getByRole('option', { name: 'Azure PowerShell', exact: true }).click()
  const powershell = await command.inputValue()
  await environment.click()
  await page.getByRole('option', { name: 'Azure CLI in PowerShell', exact: true }).click()
  const generated = await command.inputValue()
  expect(new Set([bash, powershell, generated]).size).toBe(3)
  for (const snippet of [bash, powershell, generated]) {
    const lines = snippet.split(LINE_BREAKS)
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(lines.length).toBeLessThanOrEqual(5)
    expect(lines.every((line) => line.length < 200)).toBe(true)
  }
  await dialog.getByRole('button', { name: 'Copy command', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  expect(await page.evaluate(async () => await navigator.clipboard.readText())).toBe(generated)
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Copied', exact: true })).toBeInViewport()
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await firewall.fill('')
  await expect(copy).toBeEnabled()
  await policy.fill('*')
  await expect(copy).toBeDisabled()
  await expect(
    dialog.getByText('Enter exact firewall and policy names. Wildcards are not supported.', {
      exact: true,
    }),
  ).toBeVisible()
  await policy.fill(' ')
  await expect(copy).toBeDisabled()
  await expect(command).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(trigger).toBeFocused()
})
