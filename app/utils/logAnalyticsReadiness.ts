import type { DnsReadinessSourceKind, DnsSourceReadiness } from '#shared/types/dns'
import type { LogAnalyticsStorageKind } from '#shared/types/logAnalytics'
import { DNS_READINESS_SOURCE_DEFINITIONS } from '#shared/utils/dnsReadiness'
import type { DnsReadinessStatus } from '~/composables/useDnsSourceReadiness'

export type ReadinessIndicatorState =
  | 'available'
  | 'empty'
  | 'missing'
  | 'forbidden'
  | 'failed'
  | 'checking'
  | 'unchecked'

export interface ReadinessIndicator {
  storage: LogAnalyticsStorageKind
  label: string
  state: ReadinessIndicatorState
  tone: 'success' | 'error' | 'warning' | 'neutral' | 'primary'
}

export interface ReadinessGroup {
  label: string
  items: { label: string; mapping: string; indicators: ReadinessIndicator[] }[]
}

export interface ReadinessSummary {
  label: string
  tone: 'warning' | 'success'
  unavailable: number
}

export const READINESS_COLUMNS = [
  { label: 'Dedicated tables', storage: 'resource-specific' },
  { label: 'AzureDiagnostics', storage: 'azure-diagnostics' },
] as const

function sourceIndicator(
  readiness: readonly DnsSourceReadiness[],
  status: DnsReadinessStatus,
  source: DnsReadinessSourceKind,
  storage: LogAnalyticsStorageKind,
): ReadinessIndicator {
  const item = readiness.find((value) => value.source === source && value.storage === storage)
  if (!item) {
    return status === 'loading'
      ? { storage, label: 'Checking…', state: 'checking', tone: 'primary' }
      : { storage, label: 'Not checked', state: 'unchecked', tone: 'neutral' }
  }
  if (item.status === 'success') {
    return storage === 'azure-diagnostics' && item.sampleCount === 0
      ? { storage, label: 'No data', state: 'empty', tone: 'neutral' }
      : { storage, label: 'Available', state: 'available', tone: 'success' }
  }
  if (item.status === 'missing') {
    return { storage, label: 'Not found', state: 'missing', tone: 'neutral' }
  }
  if (item.status === 'forbidden') {
    return { storage, label: 'Access denied', state: 'forbidden', tone: 'warning' }
  }
  return { storage, label: 'Check failed', state: 'failed', tone: 'error' }
}

export function getReadinessGroups(
  readiness: readonly DnsSourceReadiness[],
  status: DnsReadinessStatus,
): ReadinessGroup[] {
  const labels = { dns: 'DNS sources', general: 'General firewall logs' }
  return (['dns', 'general'] as const).map((group) => ({
    label: labels[group],
    items: DNS_READINESS_SOURCE_DEFINITIONS.filter((item) => item.group === group).map((item) => ({
      label: item.friendlyLabel,
      mapping: [
        item.resourceSpecificTable === item.azureDiagnosticsCategory
          ? item.resourceSpecificTable
          : `${item.resourceSpecificTable} / ${item.azureDiagnosticsCategory}`,
        'queryScope' in item ? item.queryScope : undefined,
      ]
        .filter(Boolean)
        .join(' · '),
      indicators: READINESS_COLUMNS.map(({ storage }) =>
        sourceIndicator(readiness, status, item.source, storage),
      ),
    })),
  }))
}

export function getReadinessSummary(readiness: readonly DnsSourceReadiness[]): ReadinessSummary {
  const dedicated = readiness.filter(
    (item) => item.storage === 'resource-specific' && item.status === 'success',
  ).length
  const diagnostics = readiness.filter(
    (item) =>
      item.storage === 'azure-diagnostics' && item.status === 'success' && item.sampleCount > 0,
  ).length
  const unavailable = readiness.filter(
    (item) => item.status === 'forbidden' || item.status === 'failed',
  ).length
  const total = DNS_READINESS_SOURCE_DEFINITIONS.length
  const allDenied = readiness.length > 0 && readiness.every((item) => item.status === 'forbidden')
  const noneChecked = dedicated + diagnostics === 0 && unavailable > 0
  let label = `Dedicated tables ${dedicated}/${total} available · AzureDiagnostics ${diagnostics}/${total} with data.`
  if (allDenied) {
    label = 'Source access is denied. Check workspace permissions, then check again.'
  } else if (noneChecked) {
    label = 'No source could be checked. Review workspace permissions, then check again.'
  }
  return {
    label,
    tone: unavailable > 0 || dedicated + diagnostics === 0 ? 'warning' : 'success',
    unavailable,
  }
}
