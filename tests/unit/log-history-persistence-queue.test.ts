import type { FirewallLogRecord } from "../../app/types/firewall";
import {
  createLogHistoryPersistenceQueue,
  type LogHistoryPersistenceQueueOptions,
} from "../../app/utils/logHistoryPersistenceQueue";
import type { LogHistoryStoreApi } from "../../app/utils/logHistoryStore";
import type { PersistedFirewallLogRecord } from "../../app/utils/logHistoryRecord";

function createLog(id: string): FirewallLogRecord {
  return {
    id,
    timestamp: "2026-07-09T12:00:00.000Z",
    category: "AZFWNetworkRule",
    action: "Allow",
    protocol: "TCP",
    message: id,
    raw: {},
    searchableText: id,
  };
}

function createStore(overrides: Partial<LogHistoryStoreApi> = {}) {
  const batches: PersistedFirewallLogRecord[][] = [];
  const store: LogHistoryStoreApi = {
    async appendLogHistoryBatch(records) {
      batches.push([...records]);
    },
    async clearLogHistory() {},
    async deleteLogHistoryBefore() {
      return 0;
    },
    async pruneLogHistory() {},
    async queryLogHistoryRange() {
      return [];
    },
    ...overrides,
  };

  return {
    batches,
    store,
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("log history persistence queue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write when disabled", async () => {
    const { batches, store } = createStore();
    const queue = createLogHistoryPersistenceQueue({ enabled: false, store });

    queue.queueRecords([createLog("log")]);
    await queue.flush();

    expect(batches).toEqual([]);
  });

  it("flushes by batch size without throwing into the caller", async () => {
    const { batches, store } = createStore();
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      maxBatchSize: 2,
      store,
    });

    expect(() => queue.queueRecords([createLog("one"), createLog("two")])).not.toThrow();
    await flushPromises();

    expect(batches.map((batch) => batch.map((record) => record.id))).toEqual([["one", "two"]]);
  });

  it("limits oversized persistence writes to configured batch size", async () => {
    const { batches, store } = createStore();
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      maxBatchSize: 2,
      store,
    });

    queue.queueRecords([
      createLog("one"),
      createLog("two"),
      createLog("three"),
      createLog("four"),
      createLog("five"),
    ]);
    await queue.waitForIdle();

    expect(batches.map((batch) => batch.map((record) => record.id))).toEqual([
      ["one", "two"],
      ["three", "four"],
      ["five"],
    ]);
  });

  it("flushes by fallback timer delay", async () => {
    const { batches, store } = createStore();
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      flushDelayMs: 500,
      maxBatchSize: 10,
      store,
    });

    queue.queueRecords([createLog("delayed")]);
    vi.advanceTimersByTime(499);
    await flushPromises();
    expect(batches).toEqual([]);

    vi.advanceTimersByTime(1);
    await flushPromises();

    expect(batches.map((batch) => batch.map((record) => record.id))).toEqual([["delayed"]]);
  });

  it("uses idle callback when available", async () => {
    const { batches, store } = createStore();
    let idleCallback: (() => void) | undefined;
    const scheduler: NonNullable<LogHistoryPersistenceQueueOptions["scheduler"]> = {
      cancelIdleCallback: vi.fn(),
      clearTimeout: vi.fn(),
      requestIdleCallback: (callback) => {
        idleCallback = () => callback({ didTimeout: false, timeRemaining: () => 10 });
        return 1;
      },
      setTimeout: vi.fn(),
    };
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      scheduler,
      store,
    });

    queue.queueRecords([createLog("idle")]);
    expect(idleCallback).toBeDefined();
    idleCallback?.();
    await flushPromises();

    expect(batches.map((batch) => batch.map((record) => record.id))).toEqual([["idle"]]);
  });

  it("disables itself when writes fail", async () => {
    const errors: unknown[] = [];
    const { store } = createStore({
      async appendLogHistoryBatch() {
        throw new Error("quota exceeded");
      },
    });
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      onError: (error) => errors.push(error),
      store,
    });

    queue.queueRecords([createLog("failed")]);
    await queue.flush();

    expect(queue.isEnabled()).toBe(false);
    expect(queue.pendingCount()).toBe(0);
    expect(errors).toHaveLength(1);
  });

  it("supports destructured control methods and prevents future writes", async () => {
    const { batches, store } = createStore();
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      store,
    });
    const { disable } = queue;

    queue.queueRecords([createLog("pending")]);
    disable();

    expect(queue.isEnabled()).toBe(false);
    expect(queue.pendingCount()).toBe(0);

    queue.queueRecords([createLog("after-disable")]);
    await queue.flush();

    expect(batches).toEqual([]);
  });

  it("waits for an active write before reporting idle", async () => {
    let resolveAppend: (() => void) | undefined;
    const startedBatches: string[][] = [];
    const { store } = createStore({
      async appendLogHistoryBatch(records) {
        startedBatches.push(records.map((record) => record.id));
        await new Promise<void>((resolve) => {
          resolveAppend = resolve;
        });
      },
    });
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      maxBatchSize: 1,
      store,
    });

    queue.queueRecords([createLog("active")]);
    expect(startedBatches).toEqual([["active"]]);
    expect(resolveAppend).toBeDefined();

    queue.disable();
    let idleResolved = false;
    const idlePromise = queue.waitForIdle().then(() => {
      idleResolved = true;
    });

    await flushPromises();
    expect(idleResolved).toBe(false);

    resolveAppend?.();
    await idlePromise;

    expect(idleResolved).toBe(true);
    expect(queue.pendingCount()).toBe(0);
  });

  it("drains records queued during an active write before reporting idle", async () => {
    const firstWrite = createDeferred();
    const secondWrite = createDeferred();
    const writes = [firstWrite, secondWrite];
    const startedBatches: string[][] = [];
    const { store } = createStore({
      async appendLogHistoryBatch(records) {
        startedBatches.push(records.map((record) => record.id));
        const write = writes.shift();
        if (!write) {
          throw new Error("Unexpected persistence write.");
        }
        await write.promise;
      },
    });
    const queue = createLogHistoryPersistenceQueue({
      enabled: true,
      maxBatchSize: 1,
      store,
    });

    queue.queueRecords([createLog("first")]);
    queue.queueRecords([createLog("second")]);
    let idleResolved = false;
    const idle = queue.waitForIdle().then(() => {
      idleResolved = true;
    });

    expect(startedBatches).toEqual([["first"]]);
    firstWrite.resolve();
    await flushPromises();

    expect(startedBatches).toEqual([["first"], ["second"]]);
    expect(idleResolved).toBe(false);

    secondWrite.resolve();
    await idle;

    expect(idleResolved).toBe(true);
    expect(queue.pendingCount()).toBe(0);
  });
});
