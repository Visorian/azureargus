import type { FirewallLogRecord } from '#shared/types/firewall'

export const LOG_HISTORY_DB_NAME = 'azure-argus-log-history'
export const LOG_HISTORY_DB_VERSION = 1
export const LOG_HISTORY_STORE_NAME = 'firewall_logs'
export const LOG_HISTORY_TIMESTAMP_INDEX = 'timestamp'
export const LOG_HISTORY_CATEGORY_INDEX = 'category'
export const LOG_HISTORY_ACTION_INDEX = 'action'
export const LOG_HISTORY_PROTOCOL_INDEX = 'protocol'
export const LOG_HISTORY_INCLUDE_RAW = false
export const LOG_HISTORY_MAX_RECORDS = 100_000
export const LOG_HISTORY_MAX_AGE_MS = 1000 * 60 * 60 * 24
export const LOG_HISTORY_MAX_WRITE_BATCH_SIZE = 500
export const LOG_HISTORY_MAX_WRITE_DELAY_MS = 1_000

export interface PersistedFirewallLogRecord {
  id: string
  timestamp: string
  category: string
  action: string
  protocol: string
  sourceIp?: string
  sourcePort?: string
  destinationIp?: string
  destinationPort?: string
  policy?: string
  ruleCollectionGroup?: string
  ruleCollection?: string
  rule?: string
  message: string
  searchableText: string
  raw?: unknown
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string'
}

export function isPersistedFirewallLogRecord(value: unknown): value is PersistedFirewallLogRecord {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'string' &&
    'timestamp' in value &&
    typeof value.timestamp === 'string' &&
    'category' in value &&
    typeof value.category === 'string' &&
    'action' in value &&
    typeof value.action === 'string' &&
    'protocol' in value &&
    typeof value.protocol === 'string' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'searchableText' in value &&
    typeof value.searchableText === 'string' &&
    isOptionalString('sourceIp' in value ? value.sourceIp : undefined) &&
    isOptionalString('sourcePort' in value ? value.sourcePort : undefined) &&
    isOptionalString('destinationIp' in value ? value.destinationIp : undefined) &&
    isOptionalString('destinationPort' in value ? value.destinationPort : undefined) &&
    isOptionalString('policy' in value ? value.policy : undefined) &&
    isOptionalString('ruleCollectionGroup' in value ? value.ruleCollectionGroup : undefined) &&
    isOptionalString('ruleCollection' in value ? value.ruleCollection : undefined) &&
    isOptionalString('rule' in value ? value.rule : undefined)
  )
}

export interface LogHistoryRetention {
  maxRecords: number
  maxAgeMs: number
}

export const DEFAULT_LOG_HISTORY_RETENTION: LogHistoryRetention = {
  maxRecords: LOG_HISTORY_MAX_RECORDS,
  maxAgeMs: LOG_HISTORY_MAX_AGE_MS,
}

export function toPersistedFirewallLogRecord(
  log: FirewallLogRecord,
  includeRaw: boolean = LOG_HISTORY_INCLUDE_RAW,
): PersistedFirewallLogRecord {
  const persisted: PersistedFirewallLogRecord = {
    id: log.id,
    timestamp: log.timestamp,
    category: log.category,
    action: log.action,
    protocol: log.protocol,
    sourceIp: log.sourceIp,
    sourcePort: log.sourcePort,
    destinationIp: log.destinationIp,
    destinationPort: log.destinationPort,
    policy: log.policy,
    ruleCollectionGroup: log.ruleCollectionGroup,
    ruleCollection: log.ruleCollection,
    rule: log.rule,
    message: log.message,
    searchableText: log.searchableText,
  }

  if (includeRaw) {
    persisted.raw = log.raw
  }

  return persisted
}

export function toPersistedFirewallLogRecords(logs: readonly FirewallLogRecord[]) {
  return logs.map((log) => toPersistedFirewallLogRecord(log))
}

export function getLogHistoryCutoffTimestamp(now = new Date(), maxAgeMs = LOG_HISTORY_MAX_AGE_MS) {
  return new Date(now.getTime() - Math.max(0, maxAgeMs)).toISOString()
}
