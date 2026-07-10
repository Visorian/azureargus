import type { FirewallLogRecord } from "../../app/types/firewall";
import { nextTick, ref } from "vue";
import {
  createCaseInsensitiveFilterOptions,
  createDefaultLogFilters,
  filterFirewallLogs,
  mergeFilteredLogCache,
  queryFirewallLogs,
  useLogQuery,
} from "../../app/composables/useLogQuery";

function createLog(overrides: Partial<FirewallLogRecord>): FirewallLogRecord {
  return {
    id: "id",
    timestamp: "2026-07-09T12:00:00.000Z",
    category: "AZFWNetworkRule",
    action: "Allow",
    protocol: "TCP",
    message: "Allow TCP",
    raw: {},
    searchableText: "azfwnetworkrule allow tcp 10.0.0.4 20.30.40.50",
    ...overrides,
  };
}

describe("log query", () => {
  it("deduplicates filter options case-insensitively", () => {
    const result = createCaseInsensitiveFilterOptions(
      ["DENY", "Deny", "deny", "allow", "ALLOW", undefined, ""],
      (value) => value.toUpperCase(),
    );

    expect(result).toEqual(["ALLOW", "DENY"]);
  });

  it("filters by search text and fields", () => {
    const filters = createDefaultLogFilters();
    filters.search = "20.30";
    filters.action = "allow";
    filters.protocol = "tcp";

    const result = filterFirewallLogs(
      [
        createLog({ id: "1", destinationIp: "20.30.40.50" }),
        createLog({ id: "2", action: "Deny", searchableText: "deny udp 10.0.0.5" }),
      ],
      filters,
    );

    expect(result.map((log) => log.id)).toEqual(["1"]);
  });

  it("matches action and protocol filters case-insensitively", () => {
    const filters = createDefaultLogFilters();
    filters.action = "DENY";
    filters.protocol = "udp";

    const result = filterFirewallLogs(
      [
        createLog({ id: "1", action: "Deny", protocol: "UDP", searchableText: "deny udp" }),
        createLog({ id: "2", action: "Allow", protocol: "UDP", searchableText: "allow udp" }),
      ],
      filters,
    );

    expect(result.map((log) => log.id)).toEqual(["1"]);
  });

  it("returns newest visible rows directly when no filters are active", () => {
    const filters = createDefaultLogFilters();

    const result = queryFirewallLogs(
      [createLog({ id: "newest" }), createLog({ id: "middle" }), createLog({ id: "oldest" })],
      filters,
      2,
    );

    expect(result.map((log) => log.id)).toEqual(["newest", "middle"]);
  });

  it("applies the visible limit after filtering", () => {
    const filters = createDefaultLogFilters();
    filters.protocol = "tcp";

    const result = queryFirewallLogs(
      [
        createLog({ id: "udp-newest-1", protocol: "UDP", searchableText: "udp" }),
        createLog({ id: "udp-newest-2", protocol: "UDP", searchableText: "udp" }),
        createLog({ id: "tcp-1", protocol: "TCP", searchableText: "tcp" }),
        createLog({ id: "tcp-2", protocol: "TCP", searchableText: "tcp" }),
      ],
      filters,
      2,
    );

    expect(result.map((log) => log.id)).toEqual(["tcp-1", "tcp-2"]);
  });

  it("stops collecting filtered matches at the visible limit", () => {
    const filters = createDefaultLogFilters();
    filters.protocol = "tcp";

    const result = filterFirewallLogs(
      [
        createLog({ id: "tcp-1", protocol: "TCP", searchableText: "tcp" }),
        createLog({ id: "tcp-2", protocol: "TCP", searchableText: "tcp" }),
        createLog({ id: "tcp-3", protocol: "TCP", searchableText: "tcp" }),
      ],
      filters,
      2,
    );

    expect(result.map((log) => log.id)).toEqual(["tcp-1", "tcp-2"]);
  });

  it("preserves active filtered matches across nonmatching stream batches", () => {
    const cached = [
      createLog({ id: "tcp-1", protocol: "TCP", searchableText: "tcp" }),
      createLog({ id: "tcp-2", protocol: "TCP", searchableText: "tcp" }),
    ];
    const currentMatches = [createLog({ id: "tcp-new", protocol: "TCP", searchableText: "tcp" })];

    const result = mergeFilteredLogCache(currentMatches, cached, 2);

    expect(result.map((log) => log.id)).toEqual(["tcp-new", "tcp-1"]);
    expect(mergeFilteredLogCache([], cached, 2).map((log) => log.id)).toEqual(["tcp-1", "tcp-2"]);
  });

  it("rebuilds filtered matches when dataset identity changes", async () => {
    const logs = ref([createLog({ id: "old", protocol: "TCP", searchableText: "tcp" })]);
    const datasetKey = ref(0);
    const { filteredLogs, filters } = useLogQuery(logs, {
      datasetKey,
      visibleLimit: ref(10),
    });

    filters.protocol = "tcp";
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["old"]);

    logs.value = [createLog({ id: "new", protocol: "TCP", searchableText: "tcp" })];
    datasetKey.value += 1;
    await nextTick();

    expect(filteredLogs.value.map((log) => log.id)).toEqual(["new"]);
  });

  it("reads the plain raw source only while filters are active", async () => {
    const logs = ref([createLog({ id: "visible-udp", protocol: "UDP", searchableText: "udp" })]);
    const rawRecords = [
      ...logs.value,
      createLog({ id: "raw-tcp", protocol: "TCP", searchableText: "tcp" }),
    ];
    const rawVersion = ref(0);
    const getRecords = vi.fn(() => rawRecords);
    const { filteredLogs, filters } = useLogQuery(logs, {
      rawSource: { getRecords, version: rawVersion },
      visibleLimit: ref(10),
    });

    expect(filteredLogs.value.map((log) => log.id)).toEqual(["visible-udp"]);
    expect(getRecords).not.toHaveBeenCalled();

    filters.protocol = "tcp";
    await nextTick();

    expect(getRecords).toHaveBeenCalledOnce();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["raw-tcp"]);
  });
});
