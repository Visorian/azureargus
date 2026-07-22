import {
  appendLogHistoryBatch,
  clearLogHistory,
  deleteLogHistoryBefore,
  queryLogHistoryRange,
} from "../../app/utils/logHistoryStore.client";
import type { PersistedFirewallLogRecord } from "../../app/utils/logHistoryRecord";

function createPersistedLog(id: string, timestamp: string) {
  return {
    action: "Allow",
    category: "AZFWNetworkRule",
    id,
    message: id,
    protocol: "TCP",
    searchableText: id,
    timestamp,
  } satisfies PersistedFirewallLogRecord;
}

beforeEach(async () => {
  await clearLogHistory();
});

afterEach(async () => {
  await clearLogHistory();
});

test("browser log history store queries, limits, deletes, and clears records", async () => {
  const now = Date.now();
  const oldest = createPersistedLog("oldest", new Date(now - 120_000).toISOString());
  const middle = createPersistedLog("middle", new Date(now - 60_000).toISOString());
  const newest = createPersistedLog("newest", new Date(now).toISOString());

  await appendLogHistoryBatch([oldest, middle, newest], {
    maxAgeMs: 60 * 60 * 1_000,
    maxRecords: 2,
  });

  const afterCountPrune = await queryLogHistoryRange({ limit: 10 });
  const limitedRange = await queryLogHistoryRange({
    from: middle.timestamp,
    limit: 1,
    to: newest.timestamp,
  });
  const deletedCount = await deleteLogHistoryBefore(newest.timestamp);
  const afterDelete = await queryLogHistoryRange({ limit: 10 });
  await clearLogHistory();
  const afterClear = await queryLogHistoryRange({ limit: 10 });

  expect(afterCountPrune.map((record) => record.id)).toEqual(["newest", "middle"]);
  expect(limitedRange.map((record) => record.id)).toEqual(["newest"]);
  expect(deletedCount).toBe(1);
  expect(afterDelete.map((record) => record.id)).toEqual(["newest"]);
  expect(afterClear).toEqual([]);
});
