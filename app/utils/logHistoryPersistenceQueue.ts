import {
  DEFAULT_LOG_HISTORY_RETENTION,
  LOG_HISTORY_MAX_WRITE_BATCH_SIZE,
  LOG_HISTORY_MAX_WRITE_DELAY_MS,
  toPersistedFirewallLogRecords,
  type LogHistoryRetention,
  type PersistedFirewallLogRecord,
} from "./logHistoryRecord";
import type { LogHistoryStoreApi } from "./logHistoryStore";
import type { FirewallLogRecord } from "~/types/firewall";

interface IdleDeadlineLike {
  didTimeout: boolean;
  timeRemaining(): number;
}

interface LogHistoryPersistenceScheduler {
  cancelIdleCallback?: (handle: number) => void;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  requestIdleCallback?: (
    callback: (deadline: IdleDeadlineLike) => void,
    options?: { timeout: number },
  ) => number;
  setTimeout: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
}

export interface LogHistoryPersistenceQueueOptions {
  enabled?: boolean;
  flushDelayMs?: number;
  maxBatchSize?: number;
  onError?: (error: unknown) => void;
  retention?: LogHistoryRetention;
  scheduler?: LogHistoryPersistenceScheduler;
  store: LogHistoryStoreApi;
}

export interface LogHistoryPersistenceQueue {
  clearQueue(): void;
  clearQueueIfDisabled(): void;
  disable(): void;
  enable(): void;
  flush(): Promise<void>;
  isEnabled(): boolean;
  pendingCount(): number;
  queueRecords(records: readonly FirewallLogRecord[]): void;
}

function createDefaultScheduler(): LogHistoryPersistenceScheduler {
  return {
    cancelIdleCallback:
      typeof cancelIdleCallback === "function" ? cancelIdleCallback.bind(globalThis) : undefined,
    clearTimeout: clearTimeout.bind(globalThis),
    requestIdleCallback:
      typeof requestIdleCallback === "function" ? requestIdleCallback.bind(globalThis) : undefined,
    setTimeout: setTimeout.bind(globalThis),
  };
}

export function createLogHistoryPersistenceQueue({
  enabled = false,
  flushDelayMs = LOG_HISTORY_MAX_WRITE_DELAY_MS,
  maxBatchSize = LOG_HISTORY_MAX_WRITE_BATCH_SIZE,
  onError,
  retention = DEFAULT_LOG_HISTORY_RETENTION,
  scheduler = createDefaultScheduler(),
  store,
}: LogHistoryPersistenceQueueOptions): LogHistoryPersistenceQueue {
  let isEnabled = enabled;
  let isFlushing = false;
  let idleHandle: number | undefined;
  let pendingRecords: PersistedFirewallLogRecord[] = [];
  let timerHandle: ReturnType<typeof setTimeout> | undefined;

  function cancelScheduledFlush() {
    if (idleHandle !== undefined && scheduler.cancelIdleCallback) {
      scheduler.cancelIdleCallback(idleHandle);
      idleHandle = undefined;
    }

    if (timerHandle !== undefined) {
      scheduler.clearTimeout(timerHandle);
      timerHandle = undefined;
    }
  }

  function scheduleFlush() {
    if (idleHandle !== undefined || timerHandle !== undefined || isFlushing) {
      return;
    }

    if (scheduler.requestIdleCallback) {
      idleHandle = scheduler.requestIdleCallback(
        () => {
          idleHandle = undefined;
          void flush();
        },
        { timeout: flushDelayMs },
      );
      return;
    }

    timerHandle = scheduler.setTimeout(() => {
      timerHandle = undefined;
      void flush();
    }, flushDelayMs);
  }

  async function flush() {
    cancelScheduledFlush();

    if (!isEnabled || pendingRecords.length === 0 || isFlushing) {
      return;
    }

    const records = pendingRecords;
    pendingRecords = [];
    isFlushing = true;

    try {
      await store.appendLogHistoryBatch(records, retention);
    } catch (error: unknown) {
      isEnabled = false;
      pendingRecords = [];
      onError?.(error);
    } finally {
      isFlushing = false;
    }

    if (isEnabled && pendingRecords.length > 0) {
      scheduleFlush();
    }
  }

  function clearQueue() {
    cancelScheduledFlush();
    pendingRecords = [];
  }

  return {
    clearQueue,
    clearQueueIfDisabled() {
      if (!isEnabled) {
        clearQueue();
      }
    },
    disable() {
      isEnabled = false;
      clearQueue();
    },
    enable() {
      isEnabled = true;
      if (pendingRecords.length > 0) {
        scheduleFlush();
      }
    },
    flush,
    isEnabled() {
      return isEnabled;
    },
    pendingCount() {
      return pendingRecords.length;
    },
    queueRecords(records) {
      if (!isEnabled || records.length === 0) {
        return;
      }

      pendingRecords.push(...toPersistedFirewallLogRecords(records));
      if (pendingRecords.length >= maxBatchSize) {
        void flush();
        return;
      }

      scheduleFlush();
    },
  };
}
