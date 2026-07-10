import {
  DEFAULT_LOG_HISTORY_RETENTION,
  getLogHistoryCutoffTimestamp,
  type LogHistoryRetention,
  type PersistedFirewallLogRecord,
} from "./logHistoryRecord";

export interface LogHistoryRangeQuery {
  from?: string;
  to?: string;
  limit?: number;
}

export interface LogHistoryStoreAdapter {
  putMany(records: readonly PersistedFirewallLogRecord[]): Promise<void>;
  queryRange(query: LogHistoryRangeQuery): Promise<PersistedFirewallLogRecord[]>;
  deleteBefore(timestamp: string): Promise<number>;
  deleteExcessRecords(maxRecords: number): Promise<number>;
  clear(): Promise<void>;
}

export interface LogHistoryStoreApi {
  appendLogHistoryBatch(
    records: readonly PersistedFirewallLogRecord[],
    retention?: LogHistoryRetention,
  ): Promise<void>;
  queryLogHistoryRange(query: LogHistoryRangeQuery): Promise<PersistedFirewallLogRecord[]>;
  deleteLogHistoryBefore(timestamp: string): Promise<number>;
  clearLogHistory(): Promise<void>;
  pruneLogHistory(retention?: LogHistoryRetention, now?: Date): Promise<void>;
}

function normalizeLimit(limit: number | undefined) {
  if (limit === undefined) {
    return undefined;
  }

  return Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0;
}

function normalizeRetention(retention: LogHistoryRetention = DEFAULT_LOG_HISTORY_RETENTION) {
  return {
    maxAgeMs: Math.max(0, retention.maxAgeMs),
    maxRecords: Number.isFinite(retention.maxRecords) ? Math.max(0, retention.maxRecords) : 0,
  };
}

export function createLogHistoryStore(adapter: LogHistoryStoreAdapter): LogHistoryStoreApi {
  async function pruneLogHistory(retention?: LogHistoryRetention, now = new Date()) {
    const normalizedRetention = normalizeRetention(retention);
    await adapter.deleteBefore(getLogHistoryCutoffTimestamp(now, normalizedRetention.maxAgeMs));
    await adapter.deleteExcessRecords(normalizedRetention.maxRecords);
  }

  return {
    async appendLogHistoryBatch(records, retention) {
      if (records.length === 0) {
        return;
      }

      await adapter.putMany(records);
      await pruneLogHistory(retention);
    },
    clearLogHistory() {
      return adapter.clear();
    },
    deleteLogHistoryBefore(timestamp) {
      return adapter.deleteBefore(timestamp);
    },
    pruneLogHistory,
    queryLogHistoryRange(query) {
      return adapter.queryRange({
        ...query,
        limit: normalizeLimit(query.limit),
      });
    },
  };
}
