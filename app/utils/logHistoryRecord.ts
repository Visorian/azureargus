import type { FirewallLogRecord } from "~/types/firewall";

export const LOG_HISTORY_DB_NAME = "azure-argus-log-history";
export const LOG_HISTORY_DB_VERSION = 1;
export const LOG_HISTORY_STORE_NAME = "firewall_logs";
export const LOG_HISTORY_TIMESTAMP_INDEX = "timestamp";
export const LOG_HISTORY_CATEGORY_INDEX = "category";
export const LOG_HISTORY_ACTION_INDEX = "action";
export const LOG_HISTORY_PROTOCOL_INDEX = "protocol";
export const LOG_HISTORY_INCLUDE_RAW = false;
export const LOG_HISTORY_MAX_RECORDS = 20_000;
export const LOG_HISTORY_MAX_AGE_MS = 1000 * 60 * 60 * 24;
export const LOG_HISTORY_MAX_WRITE_BATCH_SIZE = 500;
export const LOG_HISTORY_MAX_WRITE_DELAY_MS = 1_000;

export interface PersistedFirewallLogRecord {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  protocol: string;
  sourceIp?: string;
  sourcePort?: string;
  destinationIp?: string;
  destinationPort?: string;
  ruleCollection?: string;
  rule?: string;
  message: string;
  searchableText: string;
  raw?: unknown;
}

export interface LogHistoryRetention {
  maxRecords: number;
  maxAgeMs: number;
}

export const DEFAULT_LOG_HISTORY_RETENTION: LogHistoryRetention = {
  maxRecords: LOG_HISTORY_MAX_RECORDS,
  maxAgeMs: LOG_HISTORY_MAX_AGE_MS,
};

export function toPersistedFirewallLogRecord(log: FirewallLogRecord): PersistedFirewallLogRecord {
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
    ruleCollection: log.ruleCollection,
    rule: log.rule,
    message: log.message,
    searchableText: log.searchableText,
  };

  if (LOG_HISTORY_INCLUDE_RAW) {
    persisted.raw = log.raw;
  }

  return persisted;
}

export function toPersistedFirewallLogRecords(logs: readonly FirewallLogRecord[]) {
  return logs.map((log) => toPersistedFirewallLogRecord(log));
}

export function getLogHistoryCutoffTimestamp(now = new Date(), maxAgeMs = LOG_HISTORY_MAX_AGE_MS) {
  return new Date(now.getTime() - Math.max(0, maxAgeMs)).toISOString();
}
