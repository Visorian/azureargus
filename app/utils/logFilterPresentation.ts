import type { FirewallLogFilters, FirewallLogRecord } from '#shared/types/firewall'
import type { UiTone } from '~/types/ui'

export function formatLogEndpoint(address: string | undefined, port?: string): string {
  const value = address !== undefined && address !== '' ? address : 'Any'
  if (port === undefined || port === '') {
    return value
  }
  return `${value.includes(':') ? `[${value}]` : value}:${port}`
}
export function logFilterCount(filters: FirewallLogFilters): number {
  const textFilters = [
    filters.search,
    filters.action,
    filters.protocol,
    filters.source,
    filters.sourcePort,
    filters.destination,
    filters.destinationPort,
  ]
  return (
    Number(filters.category.length > 0) + textFilters.filter((value) => value.trim() !== '').length
  )
}
export function logFilterSummary(
  filters: FirewallLogFilters,
  range: string,
  live: boolean,
): string[] {
  const hasEndpoint = [
    filters.source,
    filters.sourcePort,
    filters.destination,
    filters.destinationPort,
  ].some((value) => value !== '')
  const endpoints = hasEndpoint
    ? `${formatLogEndpoint(filters.source, filters.sourcePort)} → ${formatLogEndpoint(filters.destination, filters.destinationPort)}`
    : 'All connections'
  const detail = [
    filters.action,
    filters.protocol,
    filters.category.length > 0
      ? `${filters.category.length} ${filters.category.length === 1 ? 'category' : 'categories'}`
      : '',
    range,
  ]
    .filter(Boolean)
    .join(' · ')
  return [
    `${live ? 'Active' : 'Applied'} · ${endpoints}`,
    detail,
    filters.search ? `Search · ${filters.search}` : '',
  ].filter(Boolean)
}
export function logActionTone(action: string): UiTone {
  const normalized = action.toLowerCase()
  if (normalized === 'deny') {
    return 'error'
  }
  if (normalized === 'allow') {
    return 'success'
  }
  if (normalized === 'dnat' || normalized === 'snat') {
    return 'primary'
  }
  return 'neutral'
}
export function logCategoryLabel(category: string): string {
  const labels: Record<string, string> = {
    AZFWApplicationRule: 'Application rules',
    AZFWNatRule: 'NAT rules',
    AZFWNetworkRule: 'Network rules',
  }
  return labels[category] ?? category
}
export function logDestination(record: FirewallLogRecord): string {
  return (
    [record.destinationIp, record.dns?.queryName, record.message].find(
      (value) => value !== undefined && value !== '',
    ) ?? 'Not recorded'
  )
}

export function logStatusTone(status: string): UiTone {
  if (status === 'connected' || status === 'success') {
    return 'success'
  }
  if (status === 'paused' || status === 'refreshing') {
    return 'warning'
  }
  if (status === 'error') {
    return 'error'
  }
  if (status === 'loading' || status === 'connecting' || status === 'reconnecting') {
    return 'primary'
  }
  return 'neutral'
}
