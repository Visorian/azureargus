import type { FirewallExport } from '../types/firewallSimulator'

type ExportResource = FirewallExport['resources'][number]

const MANAGEMENT_ORIGIN = 'https://management.azure.com'
export const AZURE_FIREWALL_API_VERSION = '2026-03-01'
const RESOURCE_ID_PATTERN =
  /^\/subscriptions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/resourceGroups\/[^/?#%\\\s]+\/providers\/Microsoft\.Network\/(firewallPolicies|azureFirewalls|ipGroups)\/[^/?#%\\\s]+$/iu

export class AzureFirewallReadError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'AzureFirewallReadError'
    this.status = status
  }
}

function isRecord(value: unknown): value is ExportResource {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function resourceKind(id: string): string {
  const match = RESOURCE_ID_PATTERN.exec(id)
  if (match === null || id.split('/').some((segment) => segment === '.' || segment === '..')) {
    throw new AzureFirewallReadError(`Invalid Azure resource ID: ${id}`, 400)
  }
  return match[1]?.toLowerCase() ?? ''
}

function validateResourceKind(id: string, expected: string): void {
  if (resourceKind(id) !== expected) {
    throw new AzureFirewallReadError(`Expected an Azure ${expected} resource ID: ${id}`, 400)
  }
}

function managementUrl(value: string): string {
  if (!URL.canParse(value)) {
    throw new AzureFirewallReadError('Azure returned an invalid pagination URL.', 502)
  }
  const url = new URL(value)
  if (url.origin !== MANAGEMENT_ORIGIN || url.username !== '' || url.password !== '') {
    throw new AzureFirewallReadError('Azure returned a URL outside management.azure.com.', 502)
  }
  return url.toString()
}

function resourceUrl(id: string): string {
  return `${MANAGEMENT_ORIGIN}${id}?api-version=${AZURE_FIREWALL_API_VERSION}`
}

function requireRecord(value: unknown, resource: string): ExportResource {
  if (!isRecord(value)) {
    throw new AzureFirewallReadError(`Azure returned invalid data for ${resource}.`, 502)
  }
  return value
}

function properties(resource: ExportResource): ExportResource {
  return requireRecord(resource['properties'], referenceId(resource, 'resource'))
}

function referenceId(value: unknown, description: string): string {
  if (!isRecord(value) || typeof value['id'] !== 'string') {
    throw new AzureFirewallReadError(`Azure returned an invalid ${description} reference.`, 502)
  }
  return value['id']
}

export async function readAzureFirewallExport(
  resourceIds: string[],
  accessToken: string,
  signal: AbortSignal,
  fetchImplementation: typeof fetch = fetch,
): Promise<FirewallExport> {
  if (resourceIds.length === 0) {
    throw new AzureFirewallReadError(
      'Enter at least one firewall or firewall policy resource ID.',
      400,
    )
  }
  const selectedIds = resourceIds.map((value) => value.trim())
  for (const id of selectedIds) {
    const kind = resourceKind(id)
    if (kind !== 'firewallpolicies' && kind !== 'azurefirewalls') {
      throw new AzureFirewallReadError('Select a firewall or firewall policy resource ID.', 400)
    }
  }

  const resources = new Map<string, ExportResource>()
  const loadedPolicies = new Set<string>()
  const referencedIpGroups = new Set<string>()

  async function readJson(url: string, description: string): Promise<ExportResource> {
    const response = await fetchImplementation(managementUrl(url), {
      headers: { authorization: `Bearer ${accessToken}` },
      redirect: 'error',
      signal,
    })
    if (!response.ok) {
      throw new AzureFirewallReadError(
        `Could not read ${description} (HTTP ${response.status}). Check Azure read access to this resource.`,
        response.status,
      )
    }
    return requireRecord(await response.json(), description)
  }

  async function readResource(id: string): Promise<ExportResource> {
    const key = id.toLowerCase()
    const cached = resources.get(key)
    if (cached !== undefined) {
      return cached
    }
    const value = await readJson(resourceUrl(id), id)
    if (typeof value['id'] !== 'string' || value['id'].toLowerCase() !== key) {
      throw new AzureFirewallReadError(`Azure returned a different resource for ${id}.`, 502)
    }
    resources.set(key, value)
    return value
  }

  function collectIpGroups(value: unknown): void {
    if (Array.isArray(value)) {
      for (const item of value) {
        collectIpGroups(item)
      }
      return
    }
    if (!isRecord(value)) {
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (key === 'sourceIpGroups' || key === 'destinationIpGroups') {
        if (item === null || item === undefined) {
          continue
        }
        if (!Array.isArray(item)) {
          throw new AzureFirewallReadError(`Azure returned an invalid ${key} list.`, 502)
        }
        for (const id of item) {
          if (typeof id !== 'string') {
            throw new AzureFirewallReadError(`Azure returned an invalid ${key} reference.`, 502)
          }
          validateResourceKind(id, 'ipgroups')
          referencedIpGroups.add(id.toLowerCase())
        }
      } else {
        collectIpGroups(item)
      }
    }
  }

  async function readGroups(policyId: string): Promise<ExportResource[]> {
    const groupValues = new Map<string, ExportResource>()
    const seenUrls = new Set<string>()
    const prefix = `${policyId}/ruleCollectionGroups/`.toLowerCase()
    let nextUrl: string | undefined = resourceUrl(`${policyId}/ruleCollectionGroups`)
    while (nextUrl !== undefined) {
      const url = managementUrl(nextUrl)
      if (seenUrls.has(url)) {
        throw new AzureFirewallReadError(`Azure returned repeated pagination for ${policyId}.`, 502)
      }
      seenUrls.add(url)
      // Each ARM page supplies the URL required for the next request.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const page = await readJson(url, `${policyId}/ruleCollectionGroups`)
      if (!Array.isArray(page['value'])) {
        throw new AzureFirewallReadError(
          `Azure returned an invalid rule collection group list for ${policyId}.`,
          502,
        )
      }
      for (const item of page['value']) {
        const group = requireRecord(item, policyId)
        const id = group['id']
        if (
          typeof id !== 'string' ||
          !id.toLowerCase().startsWith(prefix) ||
          id.slice(prefix.length).includes('/')
        ) {
          throw new AzureFirewallReadError(
            `Azure returned a rule collection group outside ${policyId}.`,
            502,
          )
        }
        const key = id.toLowerCase()
        groupValues.set(key, group)
        resources.set(key, group)
        collectIpGroups(group)
      }
      const nextLink = page['nextLink']
      if (nextLink !== undefined && nextLink !== null && typeof nextLink !== 'string') {
        throw new AzureFirewallReadError(`Azure returned an invalid nextLink for ${policyId}.`, 502)
      }
      nextUrl = typeof nextLink === 'string' && nextLink !== '' ? nextLink : undefined
    }
    return [...groupValues.values()]
  }

  async function readPolicy(id: string, ancestors: Set<string>): Promise<void> {
    validateResourceKind(id, 'firewallpolicies')
    const key = id.toLowerCase()
    if (ancestors.has(key)) {
      throw new AzureFirewallReadError(
        `Firewall policy inheritance contains a cycle at ${id}.`,
        502,
      )
    }
    if (loadedPolicies.has(key)) {
      return
    }
    const policy = await readResource(id)
    const settings = properties(policy)
    const parent = settings['basePolicy']
    if (parent !== undefined && parent !== null) {
      const parentId = referenceId(parent, 'base policy')
      const chain = new Set([...ancestors, key])
      await readPolicy(parentId, chain)
    }
    const groups = await readGroups(id)
    const groupIds = new Set(
      groups.map((group) => referenceId(group, 'rule collection group').toLowerCase()),
    )
    const declaredGroups = settings['ruleCollectionGroups']
    if (declaredGroups !== undefined) {
      if (!Array.isArray(declaredGroups)) {
        throw new AzureFirewallReadError(
          `Azure returned invalid rule collection group references for ${id}.`,
          502,
        )
      }
      for (const reference of declaredGroups) {
        if (!groupIds.has(referenceId(reference, 'rule collection group').toLowerCase())) {
          throw new AzureFirewallReadError(
            `A rule collection group referenced by ${id} is missing from its group list. Reload the policy.`,
            502,
          )
        }
      }
    }
    resources.set(key, {
      ...policy,
      properties: {
        ...settings,
        ruleCollectionGroups: groups.map((group) => ({ id: group['id'] })),
      },
    })
    loadedPolicies.add(key)
  }

  for (const id of selectedIds) {
    if (resourceKind(id) === 'azurefirewalls') {
      // Keep selected resources sequential so sibling policies share the read cache.
      // oxlint-disable-next-line eslint/no-await-in-loop
      const firewall = await readResource(id)
      const policyReference = properties(firewall)['firewallPolicy']
      if (policyReference === undefined || policyReference === null) {
        throw new AzureFirewallReadError(
          `Firewall ${id} uses classic rules. Select a firewall with a Firewall Policy.`,
          400,
        )
      }
      // oxlint-disable-next-line eslint/no-await-in-loop -- Complete this ancestry before reading a sibling that may share it.
      await readPolicy(referenceId(policyReference, 'firewall policy'), new Set())
    } else {
      // oxlint-disable-next-line eslint/no-await-in-loop -- Complete this ancestry before reading a sibling that may share it.
      await readPolicy(id, new Set())
    }
  }
  await Promise.all(Array.from(referencedIpGroups, async (id) => await readResource(id)))
  return { resources: [...resources.values()] }
}
