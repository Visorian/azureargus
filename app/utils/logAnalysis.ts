import type { FirewallLogFilters, FirewallLogSortState } from '#shared/types/firewall'

export const LOG_ANALYSIS_CATEGORIES = [
  'AZFWApplicationRule',
  'AZFWNatRule',
  'AZFWNetworkRule',
] as const

export const LOG_ANALYSIS_ACTIONS = ['Allow', 'Deny', 'DNAT', 'SNAT'] as const
export const LOG_ANALYSIS_PROTOCOLS = ['HTTP', 'HTTPS', 'ICMP', 'MSSQL', 'TCP', 'UDP'] as const
export const LOG_ANALYSIS_MAX_RANGE_MS = 24 * 60 * 60 * 1000

export type LogAnalysisRangePreset = '5' | '15' | '30' | '60' | 'custom'

export function isLogAnalysisRangePreset(value: string): value is LogAnalysisRangePreset {
  return value === '5' || value === '15' || value === '30' || value === '60' || value === 'custom'
}

export interface LogAnalysisDateRange {
  from: string
  to: string
}

type LogAnalysisDateRangeResult =
  | { ok: true; value: { from: string; to: string } }
  | { error: string; ok: false }

function padDatePart(value: number) {
  return String(value).padStart(2, '0')
}

export function formatDateTimeUtc(date: Date): string {
  return [
    date.getUTCFullYear(),
    '-',
    padDatePart(date.getUTCMonth() + 1),
    '-',
    padDatePart(date.getUTCDate()),
    'T',
    padDatePart(date.getUTCHours()),
    ':',
    padDatePart(date.getUTCMinutes()),
  ].join('')
}

export function createDefaultLogAnalysisDateRange(now = new Date()): LogAnalysisDateRange {
  return {
    from: formatDateTimeUtc(new Date(now.getTime() - 15 * 60_000)),
    to: formatDateTimeUtc(now),
  }
}

export function resolveLogAnalysisDateRange(
  draft: LogAnalysisDateRange,
  preset: LogAnalysisRangePreset,
  now = new Date(),
): LogAnalysisDateRange {
  if (preset === 'custom') {
    return draft
  }
  return {
    from: formatDateTimeUtc(new Date(now.getTime() - Number(preset) * 60_000)),
    to: formatDateTimeUtc(now),
  }
}

export function parseLogAnalysisDateRange(range: LogAnalysisDateRange): LogAnalysisDateRangeResult {
  const from = new Date(`${range.from}Z`)
  const to = new Date(`${range.to}Z`)
  const fromTimestamp = from.getTime()
  const toTimestamp = to.getTime()

  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
    return { error: 'Start and end dates are required.', ok: false }
  }
  if (fromTimestamp >= toTimestamp) {
    return { error: 'Start date must be before end date.', ok: false }
  }
  if (toTimestamp - fromTimestamp > LOG_ANALYSIS_MAX_RANGE_MS) {
    return { error: 'Log Analytics range cannot exceed 24 hours.', ok: false }
  }

  return {
    ok: true,
    value: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  }
}

export function getLogAnalysisCriteriaKey(filters: FirewallLogFilters, sort: FirewallLogSortState) {
  return [
    filters.search,
    filters.category
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .toSorted()
      .join('\u001E'),
    filters.action,
    filters.protocol,
    filters.source,
    filters.sourcePort,
    filters.destination,
    filters.destinationPort,
    sort.key,
    sort.direction,
  ]
    .map((value) => value.trim().toLowerCase())
    .join('\u001F')
}

const rangeDateFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'short',
  day: '2-digit',
})
const rangeTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function formatLogAnalysisRange(range: LogAnalysisDateRange): string {
  const start = new Date(`${range.from}Z`)
  const end = new Date(`${range.to}Z`)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    return 'Choose time range · UTC'
  }
  const startDate = rangeDateFormatter.format(start)
  const endDate = rangeDateFormatter.format(end)
  return `${startDate} ${rangeTimeFormatter.format(start)}–${startDate === endDate ? '' : `${endDate} `}${rangeTimeFormatter.format(end)} UTC`
}

export function createLogAnalysisRangeSizers(): string[] {
  return Array.from({ length: 12 }, (_, month) =>
    formatLogAnalysisRange({
      from: formatDateTimeUtc(new Date(Date.UTC(2026, month, 10, 23, 59))),
      to: formatDateTimeUtc(new Date(Date.UTC(2026, month, 11, 23, 59))),
    }),
  )
}
