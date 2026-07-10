import type { PersistedFirewallLogRecord } from "../../app/utils/logHistoryRecord";
import {
  createLogHistoryStore,
  type LogHistoryStoreAdapter,
} from "../../app/utils/logHistoryStore";

function createRecord(id: string, timestamp: string): PersistedFirewallLogRecord {
  return {
    id,
    timestamp,
    category: "AZFWNetworkRule",
    action: "Allow",
    protocol: "TCP",
    message: id,
    searchableText: id,
  };
}

function createMemoryAdapter(): LogHistoryStoreAdapter {
  const records = new Map<string, PersistedFirewallLogRecord>();

  return {
    async clear() {
      records.clear();
    },
    async deleteBefore(timestamp) {
      let deletedCount = 0;

      for (const record of records.values()) {
        if (record.timestamp < timestamp) {
          records.delete(record.id);
          deletedCount += 1;
        }
      }

      return deletedCount;
    },
    async deleteExcessRecords(maxRecords) {
      const newest = [...records.values()].sort((left, right) =>
        right.timestamp.localeCompare(left.timestamp),
      );
      const excess = newest.slice(maxRecords);

      for (const record of excess) {
        records.delete(record.id);
      }

      return excess.length;
    },
    async putMany(nextRecords) {
      for (const record of nextRecords) {
        records.set(record.id, record);
      }
    },
    async queryRange({ from, limit, to }) {
      return [...records.values()]
        .filter((record) => {
          return (!from || record.timestamp >= from) && (!to || record.timestamp <= to);
        })
        .sort((left, right) => right.timestamp.localeCompare(left.timestamp))
        .slice(0, limit);
    },
  };
}

const KEEP_ALL_TEST_RETENTION = {
  maxAgeMs: 10_000_000_000,
  maxRecords: 10,
};

describe("log history store", () => {
  it("appends and queries records newest-first", async () => {
    const store = createLogHistoryStore(createMemoryAdapter());

    await store.appendLogHistoryBatch(
      [
        createRecord("old", "2026-07-09T12:00:00.000Z"),
        createRecord("new", "2026-07-09T12:01:00.000Z"),
      ],
      KEEP_ALL_TEST_RETENTION,
    );

    await expect(store.queryLogHistoryRange({ limit: 10 })).resolves.toEqual([
      createRecord("new", "2026-07-09T12:01:00.000Z"),
      createRecord("old", "2026-07-09T12:00:00.000Z"),
    ]);
  });

  it("deletes records before a timestamp", async () => {
    const store = createLogHistoryStore(createMemoryAdapter());
    await store.appendLogHistoryBatch(
      [
        createRecord("old", "2026-07-09T12:00:00.000Z"),
        createRecord("new", "2026-07-09T12:01:00.000Z"),
      ],
      KEEP_ALL_TEST_RETENTION,
    );

    await expect(store.deleteLogHistoryBefore("2026-07-09T12:00:30.000Z")).resolves.toBe(1);
    await expect(store.queryLogHistoryRange({ limit: 10 })).resolves.toEqual([
      createRecord("new", "2026-07-09T12:01:00.000Z"),
    ]);
  });

  it("prunes records by age and count", async () => {
    const store = createLogHistoryStore(createMemoryAdapter());
    await store.appendLogHistoryBatch(
      [
        createRecord("expired", "2026-07-09T11:59:00.000Z"),
        createRecord("older", "2026-07-09T12:00:00.000Z"),
        createRecord("newer", "2026-07-09T12:01:00.000Z"),
      ],
      KEEP_ALL_TEST_RETENTION,
    );

    await store.pruneLogHistory(
      { maxAgeMs: 120_000, maxRecords: 1 },
      new Date("2026-07-09T12:01:30.000Z"),
    );

    await expect(store.queryLogHistoryRange({ limit: 10 })).resolves.toEqual([
      createRecord("newer", "2026-07-09T12:01:00.000Z"),
    ]);
  });

  it("clears only log history records", async () => {
    const store = createLogHistoryStore(createMemoryAdapter());
    await store.appendLogHistoryBatch(
      [createRecord("log", "2026-07-09T12:00:00.000Z")],
      KEEP_ALL_TEST_RETENTION,
    );

    await store.clearLogHistory();

    await expect(store.queryLogHistoryRange({ limit: 10 })).resolves.toEqual([]);
  });
});
