import type {
  FirewallSimulationResult,
  SimulationTraceEntry,
  SimulatorIpGroup,
  SimulatorRule,
} from '#shared/types/firewallSimulator'

export function resourceName(id: string): string {
  return id.split('/').findLast((part) => part.length > 0) ?? id
}

export function simulatorReason(reason: string, missingGroupIds: readonly string[]): string {
  return missingGroupIds.reduce((text, id) => text.replaceAll(id, resourceName(id)), reason)
}

export function simulatorResultPresentation(result: FirewallSimulationResult | null): {
  tone: 'warning' | 'error' | 'success'
  label: string
} {
  if (result?.verdict === 'Indeterminate') {
    return { tone: 'warning', label: 'Indeterminate' } as const
  }
  if (result?.verdict === 'Deny') {
    const label = result.trace.some((entry) => entry.status === 'match')
      ? 'Deny by configured rules'
      : 'Deny (default)'
    return { tone: 'error', label } as const
  }
  return {
    tone: 'success',
    label: result?.verdict === 'DNAT' ? 'Allow and translate (DNAT)' : 'Allow by configured rules',
  } as const
}

export function simulatorCollectionState(
  entries: readonly SimulationTraceEntry[] | undefined,
): string {
  if (entries?.some((entry) => entry.status === 'unknown') === true) {
    return 'Unresolved'
  }
  if (entries?.some((entry) => entry.status === 'match') === true) {
    return 'Matching rule'
  }
  if (
    entries !== undefined &&
    entries.length > 0 &&
    entries.every((entry) => entry.status === 'skipped')
  ) {
    return 'Skipped'
  }
  return (entries?.length ?? 0) > 0 ? 'No match' : 'Not reached'
}

export const SIMULATOR_TRACE_LABELS = {
  match: 'Match',
  'no-match': 'No match',
  unknown: 'Unresolved',
  skipped: 'Skipped',
}

export function simulatorDisplayValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => simulatorDisplayValue(item)).join(', ')
  }
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return `${value}`
  }
  return JSON.stringify(value)
}

export function simulatorAddresses(
  rule: SimulatorRule,
  groupsById: ReadonlyMap<string, SimulatorIpGroup>,
  side: 'source' | 'destination',
): string {
  const fields = rule.properties
  const parts: string[] = []
  const direct = fields[`${side}Addresses`]
  if (Array.isArray(direct) && direct.length > 0) {
    parts.push(simulatorDisplayValue(direct))
  }
  const groups = fields[`${side}IpGroups`]
  if (Array.isArray(groups)) {
    for (const id of groups) {
      if (typeof id !== 'string') {
        continue
      }
      const group = groupsById.get(id.toLowerCase())
      parts.push(
        group
          ? `IP group ${group.name}: ${
              group.addresses.length > 0 ? group.addresses.join(', ') : 'empty, rule skipped'
            }`
          : `Unresolved IP group: ${resourceName(id)}`,
      )
    }
  }
  if (side === 'destination') {
    for (const field of [
      { key: 'destinationFqdns', label: 'Destination FQDNs' },
      { key: 'targetFqdns', label: 'Target FQDNs' },
      { key: 'targetUrls', label: 'Target URLs' },
      { key: 'fqdnTags', label: 'FQDN tags' },
      { key: 'webCategories', label: 'Web categories' },
    ]) {
      const values = fields[field.key]
      if (Array.isArray(values) && values.length > 0) {
        parts.push(`${field.label}: ${simulatorDisplayValue(values)}`)
      }
    }
  }
  const locations = fields[`${side}GeoLocations`]
  if (Array.isArray(locations) && locations.length > 0) {
    parts.push(`Geolocations: ${simulatorDisplayValue(locations)}`)
  }
  const selectors = fields['sourceKubeSelectorGroups']
  if (side === 'source' && Array.isArray(selectors) && selectors.length > 0) {
    parts.push(`Kubernetes selectors: ${simulatorDisplayValue(selectors)}`)
  }
  return parts.join(' · ') || '—'
}

export function simulatorProtocols(rule: SimulatorRule): string {
  const application = rule.properties['protocols']
  if (!Array.isArray(application)) {
    return `${simulatorDisplayValue(rule.properties['ipProtocols'])} / ${simulatorDisplayValue(
      rule.properties['destinationPorts'],
    )}`
  }
  return application
    .map((protocol: unknown) => {
      if (typeof protocol !== 'object' || protocol === null) {
        return simulatorDisplayValue(protocol)
      }
      const type =
        'protocolType' in protocol
          ? simulatorDisplayValue(protocol.protocolType).toUpperCase()
          : '?'
      const port = 'port' in protocol ? simulatorDisplayValue(protocol.port) : '?'
      return `${type}:${port}`
    })
    .join(', ')
}
