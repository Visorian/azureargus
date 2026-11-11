import type {
  FirewallExport,
  FirewallJsonObject,
  FirewallJsonValue,
  FirewallProcessingPlan,
  FirewallSimulationResult,
  FirewallSnapshot,
  FirewallTrafficErrors,
  ProcessingCollection,
  SimulationTraceEntry,
  SimulatorAction,
  SimulatorIpGroup,
  SimulatorPolicy,
  SimulatorRule,
  SimulatorRuleCollection,
  SimulatorRuleCollectionGroup,
  SimulatorRuleType,
  SimulatorTraffic,
} from '../types/firewallSimulator'

const RULE_TYPES: SimulatorRuleType[] = ['DNAT', 'Network', 'Application']
const PRIORITY_MIN = 100
const PRIORITY_MAX = 65_000
const POLICY_TYPE = 'microsoft.network/firewallpolicies'
const GROUP_TYPE = `${POLICY_TYPE}/rulecollectiongroups`
const IP_GROUP_TYPE = 'microsoft.network/ipgroups'
const TRAILING_SLASH = /\/$/u
const TRAILING_DOT = /\.$/u
const BOM = /^\uFEFF/u
const CIDR_PREFIX = /^\d{1,2}$/u
const FLOW_PORT = /^\d{1,5}$/u
const GROUP_ID_SEPARATOR = '/rulecollectiongroups/'
const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/u
const PORT_RANGE = /^(\d+)(?:-(\d+))?$/u
const POLICY_PATH = /(?:^|\/)firewallpolicies\/([^/]+)$/iu
const GROUP_PATH = /(?:^|\/)firewallpolicies\/([^/]+)\/rulecollectiongroups\/([^/]+)$/iu

interface ImportedResource {
  resource: FirewallJsonObject
  owner?: string
}

interface MatchResult {
  status: 'match' | 'no-match' | 'unknown' | 'skipped'
  reason: string
}

function jsonValue(value: unknown): value is FirewallJsonValue {
  if (
    value === undefined ||
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (typeof value === 'number') {
    return Number.isFinite(value)
  }
  if (Array.isArray(value)) {
    return value.every((item: unknown) => jsonValue(item))
  }
  return record(value)
}

function record(value: unknown): value is FirewallJsonObject {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((item: unknown) => jsonValue(item))
  )
}

function properties(value: FirewallJsonObject): FirewallJsonObject {
  return record(value['properties']) ? { ...value, ...value['properties'] } : value
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`)
  }
  return value
}

function strings(value: unknown, label: string): string[] {
  if (value === undefined || value === null) {
    return []
  }
  const values = array(value, label)
  if (!values.every((item): item is string => typeof item === 'string' && item.trim().length > 0)) {
    throw new Error(`${label} must contain non-empty strings.`)
  }
  return values.map((item) => item.trim())
}

function requiredText(value: unknown, label: string): string {
  const result = text(value)
  if (result === undefined) {
    throw new Error(`${label} is required.`)
  }
  if (result.startsWith('[')) {
    throw new Error(
      `${label} contains an unresolved ARM expression. Export deployed resources instead.`,
    )
  }
  return result
}

function priority(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < PRIORITY_MIN ||
    value > PRIORITY_MAX
  ) {
    throw new Error(`${label} must be an integer from ${PRIORITY_MIN} to ${PRIORITY_MAX}.`)
  }
  return value
}

function key(value: string): string {
  return value.toLowerCase().replace(TRAILING_SLASH, '')
}

function lastName(value: string): string {
  return value.slice(value.lastIndexOf('/') + 1)
}

function resourceKind(value: FirewallJsonObject): string {
  const explicitType = text(value['type'])?.toLowerCase()
  if (explicitType !== undefined) {
    if (explicitType === 'rulecollectiongroups') {
      return GROUP_TYPE
    }
    return explicitType
  }
  if (Array.isArray(value['policies'])) {
    return ''
  }
  const fields = properties(value)
  if (Array.isArray(fields['ipAddresses'])) {
    return IP_GROUP_TYPE
  }
  if (Array.isArray(fields['ruleCollections'])) {
    return GROUP_TYPE
  }
  const id = text(value['id']) ?? ''
  if (
    POLICY_PATH.test(id) ||
    'basePolicy' in fields ||
    'ruleCollectionGroups' in fields ||
    'groups' in fields
  ) {
    return POLICY_TYPE
  }
  return ''
}

function collectResources(value: unknown, resources: ImportedResource[], owner?: string): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectResources(item, resources, owner)
    }
    return
  }
  if (!record(value)) {
    throw new Error(
      'Import JSON must contain Azure policy, rule collection group, or IP group objects.',
    )
  }
  if (text(value['nextLink']) !== undefined) {
    throw new Error(
      'This REST response has a nextLink. Fetch all pages and import their resource objects together.',
    )
  }
  const kind = resourceKind(value)
  if (kind === POLICY_TYPE) {
    const name = text(value['name']) ?? lastName(requiredText(value['id'], 'Policy ID or name'))
    const id = text(value['id']) ?? `Microsoft.Network/firewallPolicies/${name}`
    resources.push({ resource: { ...value, id, name } })
    const fields = properties(value)
    for (const field of ['ruleCollectionGroups', 'groups', 'resources']) {
      const children = fields[field]
      if (!Array.isArray(children)) {
        continue
      }
      const definitions = children.filter(
        (child) =>
          record(child) &&
          (resourceKind(child) !== '' || Array.isArray(properties(child)['ruleCollections'])),
      )
      for (const child of definitions) {
        collectResources(child, resources, id)
      }
    }
    return
  }
  if (kind === GROUP_TYPE || kind === IP_GROUP_TYPE) {
    resources.push({ owner, resource: value })
    return
  }
  let foundContainer = false
  for (const field of [
    'resources',
    'value',
    'policies',
    'ruleCollectionGroups',
    'groups',
    'ipGroups',
  ]) {
    if (Array.isArray(value[field])) {
      foundContainer = true
      collectResources(value[field], resources, owner)
    }
  }
  if (!foundContainer && text(value['type']) === undefined) {
    throw new Error(
      'No supported Azure resources found. Include policies, their rule collection groups, and referenced IP groups.',
    )
  }
}

function parseRuleType(value: unknown): SimulatorRuleType | undefined {
  switch (value) {
    case 'NatRule':
    case 'DNAT': {
      return 'DNAT'
    }
    case 'NetworkRule':
    case 'Network': {
      return 'Network'
    }
    case 'ApplicationRule':
    case 'Application': {
      return 'Application'
    }
    default: {
      return undefined
    }
  }
}

function normalizeRule(value: unknown, collectionType?: SimulatorRuleType): SimulatorRule {
  if (!record(value)) {
    throw new Error('Each firewall rule must be an object.')
  }
  const fields = properties(value)
  const name = requiredText(value['name'], 'Rule name')
  if (fields['ruleType'] !== undefined && parseRuleType(fields['ruleType']) === undefined) {
    throw new Error(`Rule ${name} has an unsupported ruleType.`)
  }
  const ruleType = parseRuleType(fields['ruleType']) ?? collectionType
  if (!ruleType) {
    throw new Error(`Rule ${name} has an unsupported or missing ruleType.`)
  }
  if (collectionType && ruleType !== collectionType) {
    throw new Error(`Rule ${name} does not match its collection type.`)
  }
  const sourceAddresses = strings(fields['sourceAddresses'], `${name} sourceAddresses`)
  const sourceIpGroups = strings(fields['sourceIpGroups'], `${name} sourceIpGroups`)
  const sourceSelectors = strings(
    fields['sourceKubeSelectorGroups'],
    `${name} sourceKubeSelectorGroups`,
  )
  const sourceLocations = strings(fields['sourceGeoLocations'], `${name} sourceGeoLocations`)
  if (
    sourceAddresses.length +
      sourceIpGroups.length +
      sourceSelectors.length +
      sourceLocations.length ===
    0
  ) {
    throw new Error(
      `Rule ${name} needs a source address, IP group, geographic location, or Kubernetes selector group.`,
    )
  }
  for (const field of [
    'destinationAddresses',
    'destinationIpGroups',
    'destinationPorts',
    'destinationFqdns',
    'destinationGeoLocations',
    'targetFqdns',
    'targetUrls',
    'fqdnTags',
    'webCategories',
  ]) {
    strings(fields[field], `${name} ${field}`)
  }
  if (ruleType === 'Application') {
    const protocols = array(fields['protocols'], `${name} protocols`)
    for (const protocol of protocols) {
      if (
        !record(protocol) ||
        !['Http', 'Https', 'Mssql'].includes(text(protocol['protocolType']) ?? '') ||
        typeof protocol['port'] !== 'number' ||
        !Number.isInteger(protocol['port']) ||
        protocol['port'] < 1 ||
        protocol['port'] > 65_535
      ) {
        throw new Error(`Rule ${name} needs valid application protocolType and port values.`)
      }
    }
    if (protocols.length === 0) {
      throw new Error(`Rule ${name} needs at least one application protocol.`)
    }
    if (
      !['targetFqdns', 'targetUrls', 'fqdnTags', 'webCategories', 'destinationAddresses'].some(
        (field) => strings(fields[field], field).length > 0,
      )
    ) {
      throw new Error(`Rule ${name} needs an application target.`)
    }
  } else {
    const protocols = strings(fields['ipProtocols'] ?? fields['protocols'], `${name} ipProtocols`)
    if (
      protocols.length === 0 ||
      protocols.some((protocol) => !['TCP', 'UDP', 'ICMP', 'ANY'].includes(protocol.toUpperCase()))
    ) {
      throw new Error(`Rule ${name} needs valid TCP, UDP, ICMP, or Any protocols.`)
    }
    if (strings(fields['destinationPorts'], `${name} destinationPorts`).length === 0) {
      throw new Error(`Rule ${name} needs destinationPorts.`)
    }
    if (
      ![
        'destinationAddresses',
        'destinationIpGroups',
        'destinationFqdns',
        'destinationGeoLocations',
      ].some((field) => strings(fields[field], field).length > 0)
    ) {
      throw new Error(`Rule ${name} needs a destination.`)
    }
    if (
      ruleType === 'DNAT' &&
      text(fields['translatedAddress']) === undefined &&
      text(fields['translatedFqdn']) === undefined
    ) {
      throw new Error(`DNAT rule ${name} needs translatedAddress or translatedFqdn.`)
    }
  }
  return { name, properties: fields, ruleType }
}

function normalizeCollection(value: unknown): SimulatorRuleCollection | undefined {
  if (!record(value)) {
    throw new Error('Each rule collection must be an object.')
  }
  const fields = properties(value)
  const name = requiredText(value['name'], 'Rule collection name')
  const collectionPriority = priority(fields['priority'], `${name} priority`)
  const rawRules = array(fields['rules'], `${name} rules`)
  if (
    (fields['ruleType'] !== undefined && parseRuleType(fields['ruleType']) === undefined) ||
    (fields['ruleCollectionType'] !== undefined &&
      !['FirewallPolicyNatRuleCollection', 'FirewallPolicyFilterRuleCollection'].includes(
        text(fields['ruleCollectionType']) ?? '',
      ))
  ) {
    throw new Error(`Collection ${name} has an unsupported rule collection type.`)
  }
  const declaredType =
    parseRuleType(fields['ruleType']) ??
    (fields['ruleCollectionType'] === 'FirewallPolicyNatRuleCollection' ? 'DNAT' : undefined)
  if (rawRules.length === 0 && !declaredType) {
    return undefined
  }
  const rules = rawRules.map((rule) => normalizeRule(rule, declaredType))
  const ruleType = declaredType ?? rules[0]?.ruleType
  if (!ruleType || rules.some((rule) => rule.ruleType !== ruleType)) {
    throw new Error(`Collection ${name} must contain a single supported rule type.`)
  }
  const actionValue = record(fields['action']) ? fields['action']['type'] : fields['action']
  let action: SimulatorAction
  if (ruleType === 'DNAT' && (actionValue === 'Dnat' || actionValue === 'DNAT')) {
    action = 'DNAT'
  } else if (ruleType !== 'DNAT' && (actionValue === 'Allow' || actionValue === 'Deny')) {
    action = actionValue
  } else {
    throw new Error(`Collection ${name} has an invalid action for ${ruleType} rules.`)
  }
  return { action, name, priority: collectionPriority, rules, ruleType }
}

function normalizeGroup(resource: FirewallJsonObject): SimulatorRuleCollectionGroup {
  const fields = properties(resource)
  const name = lastName(
    requiredText(resource['name'] ?? resource['id'], 'Rule collection group name'),
  )
  const collections: SimulatorRuleCollection[] = []
  const priorities = new Set<number>()
  for (const value of array(fields['ruleCollections'], `${name} ruleCollections`)) {
    const collection = normalizeCollection(value)
    if (collection) {
      if (priorities.has(collection.priority)) {
        throw new Error(`Group ${name} has duplicate collection priority ${collection.priority}.`)
      }
      priorities.add(collection.priority)
      collections.push(collection)
    }
  }
  return { collections, name, priority: priority(fields['priority'], `${name} priority`) }
}

function policyReference(value: unknown): string | undefined {
  if (record(value)) {
    return text(value['id'])
  }
  return text(value)
}

function findPolicy(policies: SimulatorPolicy[], id: string): SimulatorPolicy | undefined {
  const exact = policies.find((policy) => key(policy.id) === key(id))
  if (exact) {
    return exact
  }
  const candidates = policies.filter(
    (policy) => !policy.id.startsWith('/') && key(policy.name) === key(lastName(id)),
  )
  return candidates.length === 1 ? candidates[0] : undefined
}

export function normalizeFirewallSnapshot(value: unknown): FirewallSnapshot {
  const resources: ImportedResource[] = []
  collectResources(value, resources)
  const policies: SimulatorPolicy[] = []
  const ipGroups: SimulatorIpGroup[] = []
  const diagnostics: string[] = []
  const policyResources = new Map<string, FirewallJsonObject>()
  for (const { resource } of resources) {
    const kind = resourceKind(resource)
    const fields = properties(resource)
    if (kind === POLICY_TYPE) {
      const id = requiredText(resource['id'], 'Policy ID')
      if (policyResources.has(key(id))) {
        throw new Error(`Policy ${id} occurs more than once. Import one snapshot per resource.`)
      }
      policyResources.set(key(id), resource)
      policies.push({
        basePolicyId: policyReference(fields['basePolicy']) ?? text(fields['basePolicyId']),
        groups: [],
        groupsComplete: false,
        id,
        name: lastName(requiredText(resource['name'], 'Policy name')),
        settings: fields,
      })
    } else if (kind === IP_GROUP_TYPE) {
      const id = requiredText(resource['id'], 'IP group ID')
      if (ipGroups.some((group) => key(group.id) === key(id))) {
        throw new Error(`IP group ${id} occurs more than once.`)
      }
      ipGroups.push({
        addresses: strings(array(fields['ipAddresses'], `${id} ipAddresses`), `${id} ipAddresses`),
        id,
        name: lastName(text(resource['name']) ?? id),
      })
    }
  }
  if (policies.length === 0) {
    throw new Error(
      'No firewall policies found. Include each policy object along with its rule collection groups and IP groups.',
    )
  }
  const loadedGroups = new Map<string, Set<string>>()
  for (const { resource, owner } of resources) {
    if (resourceKind(resource) !== GROUP_TYPE) {
      continue
    }
    const id = text(resource['id'])
    const name = text(resource['name']) ?? (id === undefined ? undefined : lastName(id))
    const match = GROUP_PATH.exec(id ?? name ?? '')
    const separatorIndex = key(id ?? '').indexOf(GROUP_ID_SEPARATOR)
    let ownerId = owner ?? text(resource['policyId'])
    if (ownerId === undefined && id !== undefined && separatorIndex !== -1) {
      ownerId = id.slice(0, separatorIndex)
    }
    if (ownerId === undefined && match?.[1] !== undefined) {
      ownerId = `Microsoft.Network/firewallPolicies/${match[1]}`
    }
    if (ownerId === undefined && name?.includes('/') === true) {
      ownerId = `Microsoft.Network/firewallPolicies/${name.slice(0, name.lastIndexOf('/'))}`
    }
    if (ownerId === undefined && policies.length === 1) {
      ownerId = policies[0]?.id
    }
    const policy = ownerId === undefined ? undefined : findPolicy(policies, ownerId)
    if (!policy) {
      throw new Error(
        `Cannot associate collection group ${name ?? '(unnamed)'} with an imported policy. Include its full ID or policyId.`,
      )
    }
    const group = normalizeGroup(resource)
    if (
      policy.groups.some(
        (existing) =>
          key(existing.name) === key(group.name) || existing.priority === group.priority,
      )
    ) {
      throw new Error(
        `Policy ${policy.name} has a duplicate group name or priority (${group.name}).`,
      )
    }
    policy.groups.push(group)
    const loaded = loadedGroups.get(key(policy.id)) ?? new Set<string>()
    loaded.add(key(group.name))
    loadedGroups.set(key(policy.id), loaded)
  }
  for (const policy of policies) {
    const fields = properties(policyResources.get(key(policy.id)) ?? {})
    const referencedGroups = fields['ruleCollectionGroups'] ?? fields['groups']
    const loaded = loadedGroups.get(key(policy.id)) ?? new Set<string>()
    if (Array.isArray(referencedGroups)) {
      const missing = referencedGroups.filter((group) => {
        if (!record(group)) {
          throw new Error(
            `Policy ${policy.name} contains an invalid rule collection group reference.`,
          )
        }
        const name = text(group['name']) ?? text(group['id'])
        return name === undefined || !loaded.has(key(lastName(name)))
      })
      policy.groupsComplete = missing.length === 0
    }
    if (!policy.groupsComplete) {
      diagnostics.push(
        `Policy ${policy.name}: collection groups are missing or their completeness cannot be established. Include the complete collection group list.`,
      )
    }
  }
  return { diagnostics, ipGroups, policies }
}

export function parseFirewallSnapshot(input: string): FirewallSnapshot {
  const source = input.trim().replace(BOM, '')
  if (!source) {
    throw new Error('Paste or upload Azure resource JSON first.')
  }
  const documents: unknown[] = []
  let depth = 0
  let start = 0
  let quoted = false
  let escaped = false
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (depth === 0) {
      if (char?.trim() === '') {
        continue
      }
      if (char !== '{' && char !== '[') {
        throw new Error(
          'Expected JSON objects or arrays. Paste Azure CLI JSON output, an ARM resource export, or a simulator snapshot.',
        )
      }
      start = index
    }
    if (quoted) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        quoted = false
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === '{' || char === '[') {
      depth += 1
    } else if (char === '}' || char === ']') {
      depth -= 1
      if (depth === 0) {
        try {
          const document: unknown = JSON.parse(source.slice(start, index + 1))
          documents.push(document)
        } catch {
          throw new Error('Invalid JSON. Export with --output json and include complete objects.')
        }
      }
    }
  }
  if (depth !== 0 || quoted || documents.length === 0) {
    throw new Error(
      'Incomplete JSON. Include the complete policy, rule collection group, and IP group objects.',
    )
  }
  return normalizeFirewallSnapshot(documents)
}

export function buildFirewallProcessingPlan(
  snapshot: FirewallSnapshot,
  policyId: string,
): FirewallProcessingPlan {
  const warnings: string[] = []
  const incompleteReasons: string[] = []
  const policyChain: SimulatorPolicy[] = []
  const visited = new Set<string>()
  function incomplete(reason: string): void {
    incompleteReasons.push(reason)
    warnings.push(reason)
  }
  let current = findPolicy(snapshot.policies, policyId)
  if (!current) {
    throw new Error('Select an imported firewall policy.')
  }
  while (current) {
    if (visited.has(key(current.id))) {
      incomplete('The base-policy chain contains a cycle. Processing order cannot be established.')
      break
    }
    visited.add(key(current.id))
    policyChain.unshift(current)
    if (!current.groupsComplete) {
      incomplete(
        `Collection groups for ${current.name} are incomplete. Import the policy's complete group references and all of its rule collection groups. Get export command collects these and referenced IP groups together.`,
      )
    }
    if (current.basePolicyId === undefined) {
      break
    }
    const baseId = current.basePolicyId
    current = findPolicy(snapshot.policies, baseId)
    if (!current) {
      incomplete(`Base policy ${baseId} is missing. Import it and its collection groups.`)
    }
  }
  if (policyChain.length > 2) {
    incomplete(
      'This policy chain nests base policies. Azure rejects a base policy that inherits from another policy; use a base policy and direct children.',
    )
  }
  const collections: ProcessingCollection[] = []
  for (const ruleType of RULE_TYPES) {
    for (const policy of policyChain) {
      const inherited = key(policy.id) !== key(policyId)
      const ordered = policy.groups
        .toSorted((left, right) => left.priority - right.priority)
        .flatMap((group) =>
          group.collections
            .filter((item) => item.ruleType === ruleType)
            .toSorted((left, right) => left.priority - right.priority)
            .map((collection) => ({ collection, group })),
        )
      for (const { collection, group } of ordered) {
        if (inherited && ruleType === 'DNAT') {
          warnings.push(
            `DNAT collection ${collection.name} in ${policy.name} is not inherited by a child policy.`,
          )
          continue
        }
        collections.push({
          ...collection,
          groupName: group.name,
          groupPriority: group.priority,
          id: `${policy.id}/ruleCollectionGroups/${group.name}/ruleCollections/${collection.name}`,
          inherited,
          policyId: policy.id,
          policyName: policy.name,
          reason: `${ruleType} pass; ${inherited ? 'inherited policy before child policies' : 'selected policy'}; group priority ${group.priority}, then collection priority ${collection.priority}. Rules run top to bottom.`,
        })
      }
    }
  }
  const loadedIpGroups = new Set(snapshot.ipGroups.map((group) => key(group.id)))
  const missingIpGroups = new Map<string, string>()
  for (const rule of collections.flatMap((collection) => collection.rules)) {
    for (const field of ['sourceIpGroups', 'destinationIpGroups']) {
      for (const id of strings(rule.properties[field], field)) {
        if (!loadedIpGroups.has(key(id))) {
          missingIpGroups.set(key(id), id)
        }
      }
    }
  }
  return {
    collections,
    complete: incompleteReasons.length === 0,
    incompleteReasons,
    missingIpGroupIds: [...missingIpGroups.values()],
    policyChain,
    warnings,
  }
}

function ipv4(value: string): number | undefined {
  const parts = value.split('.')
  if (parts.length !== 4 || parts.some((part) => !IPV4_PART.test(part) || Number(part) > 255)) {
    return undefined
  }
  return parts.reduce((address, part) => address * 256 + Number(part), 0)
}

function addressMatches(pattern: string, address: string): boolean | undefined {
  if (pattern === '*') {
    return true
  }
  const target = ipv4(address)
  const direct = ipv4(pattern)
  if (target === undefined) {
    return undefined
  }
  if (direct !== undefined) {
    return target === direct
  }
  const slash = pattern.indexOf('/')
  if (slash !== -1) {
    const network = ipv4(pattern.slice(0, slash))
    const prefixText = pattern.slice(slash + 1)
    const prefix = Number(prefixText)
    if (network === undefined || !CIDR_PREFIX.test(prefixText) || prefix < 0 || prefix > 32) {
      return undefined
    }
    const size = 2 ** (32 - prefix)
    return Math.floor(target / size) === Math.floor(network / size)
  }
  const dash = pattern.indexOf('-')
  if (dash !== -1) {
    const first = ipv4(pattern.slice(0, dash))
    const last = ipv4(pattern.slice(dash + 1))
    return first === undefined || last === undefined || first > last
      ? undefined
      : target >= first && target <= last
  }
  return undefined
}

function anyMatch(values: (boolean | undefined)[]): boolean | undefined {
  if (values.includes(true)) {
    return true
  }
  return values.includes(undefined) ? undefined : false
}

function addressField(
  rule: SimulatorRule,
  field: 'source' | 'destination',
  address: string,
  ipGroups: SimulatorIpGroup[],
): MatchResult {
  const patterns = strings(rule.properties[`${field}Addresses`], field)
  const groupIds = strings(rule.properties[`${field}IpGroups`], field)
  const missingGroups: string[] = []
  for (const id of groupIds) {
    const group = ipGroups.find((candidate) => key(candidate.id) === key(id))
    if (!group) {
      missingGroups.push(lastName(id))
    } else if (group.addresses.length === 0) {
      return {
        reason: `Referenced ${field} IP group ${group.name} is empty; Azure skips the rule.`,
        status: 'skipped',
      }
    } else {
      patterns.push(...group.addresses)
    }
  }
  if (missingGroups.length > 0) {
    return {
      reason: `${field === 'source' ? 'Source' : 'Destination'} IP group${missingGroups.length === 1 ? '' : 's'} ${missingGroups.join(', ')} ${missingGroups.length === 1 ? 'is' : 'are'} missing. Import the referenced IP groups to evaluate this rule.`,
      status: 'unknown',
    }
  }
  if (
    field === 'source' &&
    strings(rule.properties['sourceKubeSelectorGroups'], 'sourceKubeSelectorGroups').length > 0
  ) {
    return {
      status: 'unknown',
      reason: 'Kubernetes selector membership is not available for source matching.',
    }
  }
  if (strings(rule.properties[`${field}GeoLocations`], `${field}GeoLocations`).length > 0) {
    return { status: 'unknown', reason: `Geolocation data is not available for ${field} matching.` }
  }
  const match = anyMatch(patterns.map((pattern) => addressMatches(pattern, address)))
  if (match === undefined) {
    return {
      reason: `${field === 'source' ? 'Source' : 'Destination'} requires an unresolved IP group, service tag, or unsupported address.`,
      status: 'unknown',
    }
  }
  return {
    reason: `${field === 'source' ? 'Source' : 'Destination'} address ${match ? 'matches' : 'does not match'}.`,
    status: match ? 'match' : 'no-match',
  }
}

function portMatches(pattern: string, target: string): boolean | undefined {
  if (pattern === '*') {
    return true
  }
  const match = PORT_RANGE.exec(pattern)
  const port = Number(target)
  if (!match || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return undefined
  }
  const low = Number(match[1])
  const high = Number(match[2] ?? match[1])
  if (low < 1 || high > 65_535 || low > high) {
    return undefined
  }
  return port >= low && port <= high
}

function fqdnMatches(pattern: string, host: string): boolean | undefined {
  const normalizedPattern = pattern.toLowerCase().replace(TRAILING_DOT, '')
  const normalizedHost = host.toLowerCase().replace(TRAILING_DOT, '')
  if (!normalizedHost) {
    return undefined
  }
  if (normalizedPattern === '*') {
    return true
  }
  if (!normalizedPattern.includes('*')) {
    return normalizedPattern === normalizedHost
  }
  if (normalizedPattern.startsWith('*') && !normalizedPattern.slice(1).includes('*')) {
    return normalizedHost.endsWith(normalizedPattern.slice(1))
  }
  return undefined
}

function matchStatus(value: boolean | undefined): MatchResult['status'] {
  if (value === undefined) {
    return 'unknown'
  }
  return value ? 'match' : 'no-match'
}

function conjunction(results: MatchResult[]): MatchResult {
  const skipped = results.find((result) => result.status === 'skipped')
  const mismatch = results.find((result) => result.status === 'no-match')
  const unknown = results.find((result) => result.status === 'unknown')
  return (
    skipped ??
    mismatch ??
    unknown ?? {
      reason: 'All configured source, destination, protocol, and port conditions match.',
      status: 'match',
    }
  )
}

function networkMatch(
  rule: SimulatorRule,
  traffic: SimulatorTraffic,
  ipGroups: SimulatorIpGroup[],
): MatchResult {
  const fields = rule.properties
  const protocols = new Set(
    strings(fields['ipProtocols'] ?? fields['protocols'], 'ipProtocols').map((protocol) =>
      protocol.toUpperCase(),
    ),
  )
  const ports = strings(fields['destinationPorts'], 'destinationPorts')
  const anyProtocol = protocols.has('ANY')
  const portRestricted = ports.some((port) => port !== '*')
  const protocolMatches =
    protocols.has(traffic.protocol) ||
    (anyProtocol && (!portRestricted || traffic.protocol === 'TCP' || traffic.protocol === 'UDP'))
  const source = addressField(rule, 'source', traffic.sourceIp, ipGroups)
  const destination = addressField(rule, 'destination', traffic.destinationIp, ipGroups)
  const fqdnTargets = strings(fields['destinationFqdns'], 'destinationFqdns')
  let target = destination
  if (fqdnTargets.length > 0 && destination.status !== 'match') {
    target = {
      reason:
        'Network FQDN rules depend on the firewall DNS cache. A supplied hostname does not establish the destination IP mapping.',
      status: 'unknown',
    }
  }
  const port =
    traffic.protocol === 'ICMP'
      ? true
      : anyMatch(ports.map((pattern) => portMatches(pattern, traffic.destinationPort)))
  return conjunction([
    source,
    target,
    {
      reason: protocolMatches ? 'IP protocol matches.' : 'IP protocol does not match.',
      status: protocolMatches ? 'match' : 'no-match',
    },
    {
      reason:
        port === undefined
          ? 'Destination port could not be evaluated.'
          : 'Destination port does not match.',
      status: matchStatus(port),
    },
  ])
}

function applicationMatch(
  rule: SimulatorRule,
  traffic: SimulatorTraffic,
  ipGroups: SimulatorIpGroup[],
): MatchResult {
  if (traffic.direction === 'inbound') {
    return {
      reason: 'Application rules are not applied to inbound connections.',
      status: 'skipped',
    }
  }
  if (traffic.protocol !== 'TCP' || traffic.applicationProtocol === 'None') {
    return {
      reason: 'Application rules require TCP with HTTP, HTTPS, or MSSQL.',
      status: 'skipped',
    }
  }
  const fields = rule.properties
  const source = addressField(rule, 'source', traffic.sourceIp, ipGroups)
  const protocol = array(fields['protocols'], 'protocols').some(
    (entry) =>
      record(entry) &&
      entry['protocolType'] === traffic.applicationProtocol &&
      entry['port'] === Number(traffic.destinationPort),
  )
  const fqdns = strings(fields['targetFqdns'], 'targetFqdns')
  const destinationAddresses = strings(fields['destinationAddresses'], 'destinationAddresses')
  const destinationReason =
    'Application destination addresses require the firewall DNS-resolved target. That runtime mapping is not available.'
  let target = anyMatch(fqdns.map((pattern) => fqdnMatches(pattern, traffic.targetFqdn)))
  let targetReason = 'Application hostname does not match.'
  const dynamicTargets = ['targetUrls', 'fqdnTags', 'webCategories'].some(
    (field) => strings(fields[field], field).length > 0,
  )
  if ((dynamicTargets || destinationAddresses.length > 0) && target !== true) {
    target = undefined
    targetReason =
      destinationAddresses.length > 0
        ? destinationReason
        : 'URL filtering, FQDN tags, and web categories require live classification or TLS inspection data.'
  }
  if (target === undefined && !dynamicTargets && destinationAddresses.length === 0) {
    targetReason = 'Supply the HTTP Host, HTTPS SNI, or MSSQL target FQDN to evaluate this rule.'
  }
  return conjunction([
    source,
    {
      reason: 'Application protocol or destination port does not match.',
      status: protocol ? 'match' : 'no-match',
    },
    {
      reason: targetReason,
      status: matchStatus(target),
    },
    {
      reason: destinationReason,
      status: destinationAddresses.length > 0 ? 'unknown' : 'match',
    },
  ])
}

function settingsWarnings(plan: FirewallProcessingPlan): string[] {
  const warnings = [
    ...plan.warnings,
    'This evaluates new connections. Existing TCP/UDP return traffic depends on firewall connection state.',
  ]
  for (const policy of plan.policyChain) {
    const settings = policy.settings
    const threatIntel = text(settings['threatIntelMode'])
    if (threatIntel !== undefined && threatIntel !== 'Off') {
      warnings.push(
        `${policy.name}: threat intelligence ${threatIntel} runs before configured rules; live threat feeds and allowlists are not evaluated.`,
      )
    }
    const intrusionDetection = settings['intrusionDetection']
    if (
      record(intrusionDetection) &&
      text(intrusionDetection['mode']) !== undefined &&
      intrusionDetection['mode'] !== 'Off'
    ) {
      warnings.push(
        `${policy.name}: IDPS ${text(intrusionDetection['mode'])}; Alert inspects in parallel, Deny can drop traffic after a rule match. Signature inspection is not simulated.`,
      )
    }
    if (
      record(settings['transportSecurity']) ||
      plan.collections.some(
        (collection) =>
          collection.policyId === policy.id &&
          collection.rules.some(
            (rule) =>
              rule.properties['terminateTLS'] === true || rule.properties['terminateTls'] === true,
          ),
      )
    ) {
      warnings.push(`${policy.name}: TLS inspection and certificate validation are not simulated.`)
    }
  }
  return warnings
}

export function validateFirewallTraffic(traffic: SimulatorTraffic): FirewallTrafficErrors {
  const errors: FirewallTrafficErrors = {}
  if (ipv4(traffic.sourceIp) === undefined) {
    errors.sourceIp =
      'Enter a valid IPv4 source address, for example 10.20.0.10. Ranges are not supported as connection inputs.'
  }
  if (ipv4(traffic.destinationIp) === undefined) {
    errors.destinationIp = 'Enter a valid IPv4 destination address, for example 10.30.0.4.'
  }
  if (
    traffic.protocol !== 'ICMP' &&
    (!FLOW_PORT.test(traffic.destinationPort) ||
      Number(traffic.destinationPort) < 1 ||
      Number(traffic.destinationPort) > 65_535)
  ) {
    errors.destinationPort = 'Enter a destination port from 1 to 65535.'
  }
  if (
    traffic.protocol === 'TCP' &&
    traffic.applicationProtocol !== 'None' &&
    traffic.targetFqdn.trim() === ''
  ) {
    errors.targetFqdn = 'Enter the HTTP Host, HTTPS SNI, or MSSQL target FQDN.'
  }
  return errors
}

export function simulateFirewallTraffic(
  snapshot: FirewallSnapshot,
  plan: FirewallProcessingPlan,
  traffic: SimulatorTraffic,
): FirewallSimulationResult {
  const errors = validateFirewallTraffic(traffic)
  const error =
    errors.sourceIp ?? errors.destinationIp ?? errors.destinationPort ?? errors.targetFqdn
  if (error !== undefined) {
    throw new Error(error)
  }
  const trace: SimulationTraceEntry[] = []
  const warnings = settingsWarnings(plan)
  let unresolved = !plan.complete
  let firstUnresolvedReason: string | undefined
  for (const collection of plan.collections) {
    for (const rule of collection.rules) {
      const result =
        collection.ruleType === 'Application'
          ? applicationMatch(rule, traffic, snapshot.ipGroups)
          : networkMatch(rule, traffic, snapshot.ipGroups)
      trace.push({ collectionId: collection.id, ruleName: rule.name, ...result })
      if (result.status === 'unknown') {
        unresolved = true
        firstUnresolvedReason ??= `${collection.name} / ${rule.name}: ${result.reason}`
      }
      if (result.status === 'match') {
        if (unresolved) {
          const incomplete = !plan.complete
          return {
            cause: incomplete ? 'incomplete-policy' : 'unresolved-rule',
            summary: incomplete
              ? (plan.incompleteReasons[0] ?? 'The policy configuration is incomplete.')
              : `${firstUnresolvedReason} ${collection.name} / ${rule.name} matches later, but cannot decide the result while the earlier rule is unresolved.`,
            trace,
            verdict: 'Indeterminate',
            warnings,
          }
        }
        const translatedAddress =
          text(rule.properties['translatedAddress']) ?? text(rule.properties['translatedFqdn'])
        const translatedPort = text(rule.properties['translatedPort'])
        return {
          cause: 'rule-match',
          summary: `${collection.name} / ${rule.name} (${collection.policyName}${collection.inherited ? ', inherited' : ''}) is the first matching rule. Configured-rule processing stops here.`,
          trace,
          translation:
            collection.action === 'DNAT'
              ? `${translatedAddress ?? '(unknown target)'}:${translatedPort ?? traffic.destinationPort}`
              : undefined,
          verdict: collection.action,
          warnings,
        }
      }
    }
  }
  const infrastructure =
    traffic.direction === 'outbound' &&
    traffic.protocol === 'TCP' &&
    traffic.applicationProtocol !== 'None'
  if (infrastructure) {
    warnings.push(
      'The built-in infrastructure collection runs after application rules. Its platform-specific FQDNs are not included in policy exports, so its outcome is unknown.',
    )
  }
  let cause: FirewallSimulationResult['cause']
  let summary: string
  if (!plan.complete) {
    cause = 'incomplete-policy'
    summary = plan.incompleteReasons[0] ?? 'The policy configuration is incomplete.'
  } else if (firstUnresolvedReason !== undefined) {
    cause = 'unresolved-rule'
    summary = firstUnresolvedReason
  } else if (infrastructure) {
    cause = 'infrastructure'
    summary =
      "No configured rule matches. Azure's built-in infrastructure collection may still allow platform FQDNs; otherwise default deny applies."
  } else {
    cause = 'default-deny'
    summary = 'No configured rule matches. Azure Firewall denies the new connection by default.'
    if (
      traffic.direction === 'outbound' &&
      traffic.protocol === 'TCP' &&
      traffic.applicationProtocol === 'None' &&
      plan.collections.some((collection) => collection.ruleType === 'Application')
    ) {
      summary +=
        ' Application rules were not evaluated because Application protocol is None. For HTTP, HTTPS or MSSQL traffic, choose it and enter the host.'
    }
  }
  return {
    cause,
    summary,
    trace,
    verdict: cause === 'default-deny' ? 'Deny' : 'Indeterminate',
    warnings,
  }
}

export function exportFirewallSnapshot(snapshot: FirewallSnapshot): FirewallExport {
  const resources: FirewallJsonObject[] = []
  for (const policy of snapshot.policies) {
    const settings = Object.fromEntries(
      Object.entries(policy.settings).filter(
        ([field]) =>
          !['id', 'name', 'type', 'properties', 'resources', 'groups', 'basePolicyId'].includes(
            field,
          ),
      ),
    )
    const groups = policy.groups.map((group) => ({
      id: `${policy.id}/ruleCollectionGroups/${group.name}`,
    }))
    resources.push({
      id: policy.id,
      name: policy.name,
      type: 'Microsoft.Network/firewallPolicies',
      properties: {
        ...settings,
        basePolicy: policy.basePolicyId === undefined ? undefined : { id: policy.basePolicyId },
        ruleCollectionGroups: policy.groupsComplete ? groups : settings['ruleCollectionGroups'],
      },
    })
    for (const group of policy.groups) {
      resources.push({
        id: `${policy.id}/ruleCollectionGroups/${group.name}`,
        name: group.name,
        type: 'Microsoft.Network/firewallPolicies/ruleCollectionGroups',
        properties: {
          priority: group.priority,
          ruleCollections: group.collections.map((collection) => ({
            name: collection.name,
            priority: collection.priority,
            action: { type: collection.action === 'DNAT' ? 'Dnat' : collection.action },
            ruleCollectionType:
              collection.ruleType === 'DNAT'
                ? 'FirewallPolicyNatRuleCollection'
                : 'FirewallPolicyFilterRuleCollection',
            ruleType: collection.ruleType,
            rules: collection.rules.map((rule) => ({
              ...rule.properties,
              name: rule.name,
              ruleType: `${rule.ruleType === 'DNAT' ? 'Nat' : rule.ruleType}Rule`,
            })),
          })),
        },
      })
    }
  }
  for (const group of snapshot.ipGroups) {
    resources.push({
      id: group.id,
      name: group.name,
      type: 'Microsoft.Network/ipGroups',
      properties: { ipAddresses: group.addresses },
    })
  }
  return { resources }
}
