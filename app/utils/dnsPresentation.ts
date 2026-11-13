import type { DnsEntry, DnsObservation, DnsRelatedEvidence, DnsSort } from '#shared/types/dns'
import {
  DNS_CLASS_LABELS,
  DNS_FLAG_LABELS,
  DNS_RCODE_LABELS,
  dnsObservationEndpoint,
  formatDnsDuration,
  formatDnsEndpoint,
} from '#shared/utils/dns'
import { DNS_READINESS_SOURCE_DEFINITIONS } from '#shared/utils/dnsReadiness'
import type { DisplayField } from '~/types/ui'

export const DNS_SOURCE_AVAILABILITY_LABELS = {
  available: 'Available',
  forbidden: 'Access denied',
  failed: 'Query failed',
  'not-applicable': 'Not applicable',
} as const

export const DNS_ENTRY_COLUMNS: { label: string; key?: DnsSort['key'] }[] = [
  { label: 'Time', key: 'timestamp' },
  { label: 'DNS name or message', key: 'queryName' },
  { label: 'Client' },
  { label: 'Destination' },
  { label: 'Result' },
  { label: 'Duration', key: 'duration' },
  { label: 'Evidence' },
  { label: 'Count', key: 'observations' },
]

export const DNS_SORT_ITEMS = [
  { label: 'Newest first', value: 'timestamp-desc', key: 'timestamp', direction: 'desc' },
  { label: 'Oldest first', value: 'timestamp-asc', key: 'timestamp', direction: 'asc' },
  { label: 'Query name A–Z', value: 'queryName-asc', key: 'queryName', direction: 'asc' },
  { label: 'Query name Z–A', value: 'queryName-desc', key: 'queryName', direction: 'desc' },
  { label: 'Shortest duration first', value: 'duration-asc', key: 'duration', direction: 'asc' },
  { label: 'Longest duration first', value: 'duration-desc', key: 'duration', direction: 'desc' },
  {
    label: 'Fewest observations first',
    value: 'observations-asc',
    key: 'observations',
    direction: 'asc',
  },
  {
    label: 'Most observations first',
    value: 'observations-desc',
    key: 'observations',
    direction: 'desc',
  },
] as const

export function dnsSourceLabel(source: string) {
  if (source === 'dns-proxy') {
    return 'Legacy DNS proxy logs'
  }
  return (
    DNS_READINESS_SOURCE_DEFINITIONS.find((item) => item.source === source)?.friendlyLabel ?? source
  )
}

export function dnsModalTitle(entry: DnsEntry | null) {
  if (entry?.source === 'network-rule') {
    return 'DNS transport detail'
  }
  if (entry?.source === 'dns-flow-trace') {
    return 'DNS flow trace detail'
  }
  if (entry?.source === 'internal-fqdn-failure') {
    return 'Internal FQDN failure detail'
  }
  return 'DNS resolution detail'
}

export function dnsStageActor(observation: DnsObservation) {
  if (observation.stage === 'transport') {
    return 'Network rule'
  }
  if (observation.stage === 'internal-resolution') {
    return 'Azure Firewall resolver'
  }
  return 'Azure Firewall'
}

export function dnsObservationFields(observation: DnsObservation): DisplayField[] {
  const fields: DisplayField[] = [{ label: 'Source', value: dnsSourceLabel(observation.source) }]
  function add(label: string, value: string | number | undefined, mono = false) {
    if (value !== undefined && value !== '') {
      fields.push({ label, value: String(value), mono })
    }
  }
  add('Protocol', observation.protocol)
  add('Firewall action', observation.action)
  if (observation.clientIp) {
    add('Client endpoint', dnsObservationEndpoint(observation, 'client'), true)
  }
  if (observation.serverIp) {
    add('Destination endpoint', dnsObservationEndpoint(observation, 'server'), true)
  }
  if (observation.responseCode) {
    add(
      'Response code',
      [observation.responseCode, DNS_RCODE_LABELS[observation.responseCode]]
        .filter(Boolean)
        .join(' — '),
    )
  }
  if (observation.queryClass) {
    add(
      'Query class',
      [observation.queryClass, DNS_CLASS_LABELS[observation.queryClass]]
        .filter(Boolean)
        .join(' — '),
    )
  }
  if (observation.requestSizeBytes !== undefined) {
    add('Request size', `${observation.requestSizeBytes} bytes`)
  }
  if (observation.responseSizeBytes !== undefined) {
    add('Response size', `${observation.responseSizeBytes} bytes, not TTL`)
  }
  if (observation.ednsBufferSizeBytes !== undefined) {
    add('EDNS0 buffer', `${observation.ednsBufferSizeBytes} bytes`)
  }
  if (observation.dnssecOk !== undefined) {
    add('DNSSEC OK', observation.dnssecOk ? 'Set' : 'Not set')
  }
  if (observation.durationSeconds !== undefined) {
    add(
      'Azure-reported transaction duration',
      `${formatDnsDuration(observation.durationSeconds)} · ${observation.durationSeconds} s exact`,
    )
  }
  add('Error number', observation.errorNumber)
  add('Error message', observation.errorMessage)
  add('Message type', observation.msgType)
  add('Query message', observation.queryMessage, true)
  add('Server message', observation.serverMessage, true)
  add('Azure query time', observation.queryTime, true)
  add('Azure response time', observation.responseTime, true)
  add('Socket family', observation.socketFamily)
  add('Firewall policy', observation.policy, true)
  add('Rule collection group', observation.ruleCollectionGroup, true)
  add('Rule collection', observation.ruleCollection, true)
  add('Rule', observation.rule, true)
  add('Azure resource', observation.resourceId, true)
  for (const flag of observation.responseFlags) {
    add(`Flag ${flag}`, DNS_FLAG_LABELS[flag.toLowerCase()] ?? 'Unknown flag')
  }
  return fields
}

export function dnsRelatedFields(evidence: DnsRelatedEvidence): DisplayField[] {
  const values: [string, string | undefined, boolean?][] = [
    ['Action', evidence.action],
    ['Reason', evidence.actionReason],
    ['Protocol', evidence.protocol],
    [
      'Source endpoint',
      evidence.sourceIp ? formatDnsEndpoint(evidence.sourceIp, evidence.sourcePort) : undefined,
      true,
    ],
    [
      'Destination endpoint',
      evidence.destinationIp
        ? formatDnsEndpoint(evidence.destinationIp, evidence.destinationPort)
        : undefined,
      true,
    ],
    ['DNS name', evidence.queryName, true],
    ['Target URL', evidence.targetUrl, true],
    ['Flag', evidence.flag],
    [
      'Translated endpoint',
      evidence.translatedIp
        ? formatDnsEndpoint(evidence.translatedIp, evidence.translatedPort)
        : undefined,
      true,
    ],
    ['Firewall policy', evidence.policy, true],
    ['Rule collection group', evidence.ruleCollectionGroup, true],
    ['Rule collection', evidence.ruleCollection, true],
    ['Rule', evidence.rule, true],
    ['Azure resource', evidence.resourceId, true],
  ]
  return values.flatMap(([label, value, mono]) => (value ? [{ label, value, mono }] : []))
}
