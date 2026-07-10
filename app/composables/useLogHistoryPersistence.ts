import {
  createLogHistoryPersistenceQueue,
  type LogHistoryPersistenceQueue,
} from "~/utils/logHistoryPersistenceQueue";
import type { LogHistoryRangeQuery, LogHistoryStoreApi } from "~/utils/logHistoryStore";
import type { PersistedFirewallLogRecord } from "~/utils/logHistoryRecord";
import type { FirewallLogRecord } from "~/types/firewall";

let sharedQueue: LogHistoryPersistenceQueue | null = null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown log history persistence error.";
}

function isIndexedDBAvailable() {
  return typeof indexedDB !== "undefined";
}

function createBrowserLogHistoryStore(): LogHistoryStoreApi {
  return {
    async appendLogHistoryBatch(records, retention) {
      if (!isIndexedDBAvailable()) {
        return;
      }

      const store = await import("~/utils/logHistoryStore.client");
      await store.appendLogHistoryBatch(records, retention);
    },
    async clearLogHistory() {
      if (!isIndexedDBAvailable()) {
        return;
      }

      const store = await import("~/utils/logHistoryStore.client");
      await store.clearLogHistory();
    },
    async deleteLogHistoryBefore(timestamp) {
      if (!isIndexedDBAvailable()) {
        return 0;
      }

      const store = await import("~/utils/logHistoryStore.client");
      return store.deleteLogHistoryBefore(timestamp);
    },
    async pruneLogHistory(retention, now) {
      if (!isIndexedDBAvailable()) {
        return;
      }

      const store = await import("~/utils/logHistoryStore.client");
      await store.pruneLogHistory(retention, now);
    },
    async queryLogHistoryRange(query) {
      if (!isIndexedDBAvailable()) {
        return [];
      }

      const store = await import("~/utils/logHistoryStore.client");
      return store.queryLogHistoryRange(query);
    },
  };
}

export function useLogHistoryPersistence() {
  const enabled = useState("log-history-enabled", () => false);
  const historyResults = useState<PersistedFirewallLogRecord[]>("log-history-results", () => []);
  const lastError = useState<string | null>("log-history-last-error", () => null);
  const store = createBrowserLogHistoryStore();

  if (sharedQueue === null) {
    sharedQueue = createLogHistoryPersistenceQueue({
      enabled: enabled.value,
      onError: (error) => {
        enabled.value = false;
        lastError.value = getErrorMessage(error);
      },
      store,
    });
  }

  function enable() {
    lastError.value = null;
    enabled.value = true;
    sharedQueue?.enable();
  }

  function disable() {
    enabled.value = false;
    sharedQueue?.disable();
  }

  function queueRecords(records: readonly FirewallLogRecord[]) {
    if (!enabled.value) {
      return;
    }

    sharedQueue?.queueRecords(records);
  }

  async function flush() {
    await sharedQueue?.flush();
  }

  function clearQueueIfDisabled() {
    sharedQueue?.clearQueueIfDisabled();
  }

  async function queryHistoryRange(query: LogHistoryRangeQuery) {
    lastError.value = null;

    try {
      historyResults.value = await store.queryLogHistoryRange(query);
      return historyResults.value;
    } catch (error: unknown) {
      lastError.value = getErrorMessage(error);
      historyResults.value = [];
      return [];
    }
  }

  async function clearHistory() {
    lastError.value = null;

    try {
      await store.clearLogHistory();
      historyResults.value = [];
    } catch (error: unknown) {
      lastError.value = getErrorMessage(error);
    }
  }

  return {
    clearHistory,
    clearQueueIfDisabled,
    disable,
    enable,
    enabled,
    flush,
    historyResults,
    lastError,
    queueRecords,
    queryHistoryRange,
  };
}
