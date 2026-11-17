import type {
  AzureAccessibleTenant,
  AzureAccessibleWorkspace,
  AzureLogAnalyticsAccess,
} from '../types/azureAccess'
import { isJsonObject } from './json'

const MANAGEMENT_ORIGIN = 'https://management.azure.com'
const SUBSCRIPTIONS_API_VERSION = '2022-12-01'
const RESOURCE_GRAPH_API_VERSION = '2024-04-01'
const WORKSPACE_QUERY =
  "Resources | where type =~ 'microsoft.operationalinsights/workspaces' | project name, location, subscriptionId, resourceGroup, workspaceId=tostring(properties.customerId)"
const UUID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu
const collator = new Intl.Collator()

interface AzurePage {
  value: unknown[]
  nextLink?: string
}

interface AzureSubscription {
  subscriptionId: string
  displayName: string
}

export class AzureResourceDiscoveryError extends Error {
  readonly status: number

  constructor(status: number) {
    super('Azure resource discovery failed')
    this.status = status
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function isUuid(value: string | null): value is string {
  return value !== null && UUID_PATTERN.test(value)
}

function readDisplayName(value: unknown, fallback: string): string {
  const displayName = readString(value)?.trim()
  return displayName === undefined || displayName === '' ? fallback : displayName
}

function validateManagementUrl(value: string) {
  const url = new URL(value)
  if (url.origin !== MANAGEMENT_ORIGIN || url.protocol !== 'https:') {
    throw new AzureResourceDiscoveryError(502)
  }
  return url.toString()
}

function validateManagementResponse(response: Response) {
  if (response.redirected) {
    throw new AzureResourceDiscoveryError(502)
  }
  if (response.url) {
    validateManagementUrl(response.url)
  }
}

async function readPage(
  url: string,
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
): Promise<AzurePage> {
  const response = await fetchImplementation(validateManagementUrl(url), {
    headers: { authorization: `Bearer ${accessToken}` },
    redirect: 'error',
    signal,
  })
  validateManagementResponse(response)
  if (!response.ok) {
    throw new AzureResourceDiscoveryError(response.status)
  }

  const value: unknown = await response.json()
  if (!isJsonObject(value) || !Array.isArray(value['value'])) {
    throw new AzureResourceDiscoveryError(502)
  }
  const nextLink = readString(value['nextLink']) ?? undefined
  return { nextLink, value: value['value'] }
}

async function readAllPages(
  initialUrl: string,
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
): Promise<unknown[]> {
  const values: unknown[] = []
  const seenUrls = new Set<string>()
  const readFrom = async (url: string): Promise<void> => {
    if (seenUrls.has(url)) {
      throw new AzureResourceDiscoveryError(502)
    }
    seenUrls.add(url)
    const page = await readPage(url, accessToken, signal, fetchImplementation)
    values.push(...page.value)
    if (page.nextLink !== undefined) {
      await readFrom(page.nextLink)
    }
  }
  await readFrom(initialUrl)
  return values
}

function parseTenants(values: unknown[]) {
  const tenants = new Map<string, AzureAccessibleTenant>()
  for (const value of values) {
    if (!isJsonObject(value)) {
      continue
    }
    const tenantId = readString(value['tenantId'])
    if (!isUuid(tenantId)) {
      continue
    }
    const displayName = readDisplayName(value['displayName'], tenantId)
    tenants.set(tenantId, {
      defaultDomain: readString(value['defaultDomain']),
      displayName,
      tenantId,
    })
  }
  return [...tenants.values()].toSorted((left, right) =>
    collator.compare(left.displayName, right.displayName),
  )
}

function parseSubscriptions(values: unknown[]) {
  const subscriptions = new Map<string, AzureSubscription>()
  for (const value of values) {
    if (!isJsonObject(value)) {
      continue
    }
    const subscriptionId = readString(value['subscriptionId'])
    if (!isUuid(subscriptionId)) {
      continue
    }
    subscriptions.set(subscriptionId, {
      displayName: readDisplayName(value['displayName'], subscriptionId),
      subscriptionId,
    })
  }
  return [...subscriptions.values()]
}

function parseWorkspaces(values: unknown[], subscriptions: ReadonlyMap<string, AzureSubscription>) {
  const workspaces: AzureAccessibleWorkspace[] = []
  for (const value of values) {
    if (!isJsonObject(value)) {
      continue
    }
    const workspaceId = readString(value['workspaceId'])
    const name = readString(value['name'])
    const subscriptionId = readString(value['subscriptionId'])
    if (!isUuid(workspaceId) || name === null || name === '' || !isUuid(subscriptionId)) {
      continue
    }
    const subscription = subscriptions.get(subscriptionId)
    workspaces.push({
      location: readString(value['location']) ?? '',
      name,
      resourceGroup: readString(value['resourceGroup']) ?? '',
      subscriptionId,
      subscriptionName: subscription?.displayName ?? subscriptionId,
      workspaceId,
    })
  }
  return workspaces
}

async function readWorkspaceGraph(
  subscriptions: AzureSubscription[],
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch,
): Promise<AzureAccessibleWorkspace[]> {
  if (subscriptions.length === 0) {
    return []
  }
  const subscriptionIds = subscriptions.map((subscription) => subscription.subscriptionId)
  const subscriptionMap = new Map(
    subscriptions.map((subscription) => [subscription.subscriptionId, subscription]),
  )
  const values: unknown[] = []
  const seenSkipTokens = new Set<string>()
  const readFrom = async (skipToken: string | undefined): Promise<void> => {
    const hasSkipToken = skipToken !== undefined && skipToken !== ''
    const response = await fetchImplementation(
      `${MANAGEMENT_ORIGIN}/providers/Microsoft.ResourceGraph/resources?api-version=${RESOURCE_GRAPH_API_VERSION}`,
      {
        body: JSON.stringify({
          options: hasSkipToken ? { $skipToken: skipToken } : undefined,
          query: WORKSPACE_QUERY,
          subscriptions: subscriptionIds,
        }),
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        method: 'POST',
        redirect: 'error',
        signal,
      },
    )
    validateManagementResponse(response)
    if (!response.ok) {
      throw new AzureResourceDiscoveryError(response.status)
    }
    const value: unknown = await response.json()
    if (!isJsonObject(value) || !Array.isArray(value['data'])) {
      throw new AzureResourceDiscoveryError(502)
    }
    const data: unknown[] = value['data']
    values.push(...data)
    const nextSkipToken = readString(value['$skipToken']) ?? undefined
    if (nextSkipToken === undefined) {
      return
    }
    if (nextSkipToken !== '') {
      if (seenSkipTokens.has(nextSkipToken)) {
        throw new AzureResourceDiscoveryError(502)
      }
      seenSkipTokens.add(nextSkipToken)
    }
    await readFrom(nextSkipToken)
  }
  await readFrom(undefined)

  return parseWorkspaces(values, subscriptionMap)
}

export async function discoverAzureLogAnalyticsAccess(
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
): Promise<AzureLogAnalyticsAccess> {
  const [tenantValues, subscriptionValues] = await Promise.all([
    readAllPages(
      `${MANAGEMENT_ORIGIN}/tenants?api-version=${SUBSCRIPTIONS_API_VERSION}`,
      accessToken,
      signal,
      fetchImplementation,
    ),
    readAllPages(
      `${MANAGEMENT_ORIGIN}/subscriptions?api-version=${SUBSCRIPTIONS_API_VERSION}`,
      accessToken,
      signal,
      fetchImplementation,
    ),
  ])
  const subscriptions = parseSubscriptions(subscriptionValues)
  const discoveredWorkspaces = await readWorkspaceGraph(
    subscriptions,
    accessToken,
    signal,
    fetchImplementation,
  )
  const workspaces = new Map<string, AzureAccessibleWorkspace>()
  for (const workspace of discoveredWorkspaces) {
    workspaces.set(workspace.workspaceId, workspace)
  }

  return {
    tenants: parseTenants(tenantValues),
    workspaces: [...workspaces.values()].toSorted((left, right) =>
      collator.compare(left.name, right.name),
    ),
  }
}
