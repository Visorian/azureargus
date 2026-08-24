import type { FirewallLogRecord } from "../../shared/types/firewall";
import { nextTick, ref } from "vue";
import {
  createCaseInsensitiveFilterOptions,
  createDefaultLogFilters,
  filterFirewallLogs,
  isLogCategoryFilterValueActive,
  isLogFilterValueActive,
  mergeFilteredLogCache,
  queryFirewallLogs,
  toggleLogCategoryFilterValue,
  toggleLogFilterValue,
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

  it("toggles exact quick-filter values case-insensitively", () => {
    expect(toggleLogFilterValue("", " Allow ")).toBe("Allow");
    expect(toggleLogFilterValue("allow", "ALLOW")).toBe("");
    expect(toggleLogFilterValue("Allow", undefined)).toBe("Allow");
    expect(isLogFilterValueActive(" allow ", "ALLOW")).toBe(true);
    expect(isLogFilterValueActive("Allow", "Deny")).toBe(false);
  });

  it("toggles multiple category quick-filter values case-insensitively", () => {
    expect(toggleLogCategoryFilterValue([], " AZFWNetworkRule ")).toEqual(["AZFWNetworkRule"]);
    expect(toggleLogCategoryFilterValue(["AZFWNetworkRule"], "AZFWApplicationRule")).toEqual([
      "AZFWNetworkRule",
      "AZFWApplicationRule",
    ]);
    expect(
      toggleLogCategoryFilterValue(["AZFWNetworkRule", "AZFWApplicationRule"], "azfwnetworkrule"),
    ).toEqual(["AZFWApplicationRule"]);
    expect(isLogCategoryFilterValueActive([" AZFWNetworkRule "], "azfwnetworkrule")).toBe(true);
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

  it("matches source and destination endpoints exactly", () => {
    const logs = [
      createLog({
        id: "exact",
        sourceIp: "10.141.8.1",
        sourcePort: "443",
        destinationIp: "Example.COM",
        destinationPort: "8443",
      }),
      createLog({
        id: "prefix",
        sourceIp: "10.141.8.11",
        sourcePort: "4431",
        destinationIp: "example.com.evil",
        destinationPort: "84431",
      }),
    ];
    const filters = createDefaultLogFilters();

    filters.source = "10.141.8.1";
    expect(filterFirewallLogs(logs, filters).map((log) => log.id)).toEqual(["exact"]);

    filters.source = "443";
    expect(filterFirewallLogs(logs, filters).map((log) => log.id)).toEqual(["exact"]);

    filters.source = "10.141.8.1:443";
    expect(filterFirewallLogs(logs, filters).map((log) => log.id)).toEqual(["exact"]);

    filters.source = "";
    filters.destination = "example.com";
    expect(filterFirewallLogs(logs, filters).map((log) => log.id)).toEqual(["exact"]);

    filters.destination = "8443";
    expect(filterFirewallLogs(logs, filters).map((log) => log.id)).toEqual(["exact"]);

    filters.destination = "EXAMPLE.COM:8443";
    expect(filterFirewallLogs(logs, filters).map((log) => log.id)).toEqual(["exact"]);
  });

  it("matches any selected category exactly and case-insensitively", () => {
    const filters = createDefaultLogFilters();
    filters.category = ["azfwnetworkrule", "AZFWApplicationRule"];

    const result = filterFirewallLogs(
      [
        createLog({ id: "network", category: "AZFWNetworkRule" }),
        createLog({ id: "application", category: "AZFWApplicationRule" }),
        createLog({ id: "nat", category: "AZFWNatRule" }),
        createLog({ id: "partial", category: "AZFWNetworkRuleAggregation" }),
      ],
      filters,
    );

    expect(result.map((log) => log.id)).toEqual(["network", "application"]);
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

  it("limits visible filtered matches", () => {
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

  it("keeps filters isolated between query instances", async () => {
    const realTime = useLogQuery(ref([createLog({ id: "real-time" })]));
    const logAnalysis = useLogQuery(ref([createLog({ id: "log-analysis" })]));

    realTime.filters.action = "Deny";
    await nextTick();

    expect(realTime.filters.action).toBe("Deny");
    expect(logAnalysis.filters.action).toBe("");
    expect(logAnalysis.filteredLogs.value.map((log) => log.id)).toEqual(["log-analysis"]);
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

  it("retains surfaced matches across filter changes after raw-buffer eviction", async () => {
    const destinationIp = "131.189.255.123";
    const matchingLogs = [
      createLog({
        id: "nat-2",
        category: "AZFWNatRule",
        destinationIp,
        searchableText: `azfwnatrule ${destinationIp}`,
      }),
      createLog({
        id: "network-2",
        destinationIp,
        searchableText: `azfwnetworkrule ${destinationIp}`,
      }),
      createLog({
        id: "nat-1",
        category: "AZFWNatRule",
        destinationIp,
        searchableText: `azfwnatrule ${destinationIp}`,
      }),
      createLog({
        id: "network-1",
        destinationIp,
        searchableText: `azfwnetworkrule ${destinationIp}`,
      }),
    ];
    const latestLog = createLog({
      id: "latest",
      category: "AZFWApplicationRule",
      searchableText: "azfwapplicationrule latest",
    });
    const logs = ref([...matchingLogs]);
    let rawRecords: FirewallLogRecord[] = [...matchingLogs];
    const rawVersion = ref(0);
    const { filteredLogs, filters } = useLogQuery(logs, {
      rawSource: { getRecords: () => rawRecords, version: rawVersion },
      visibleLimit: ref(10),
    });

    filters.search = destinationIp;
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual([
      "nat-2",
      "network-2",
      "nat-1",
      "network-1",
    ]);

    logs.value = [latestLog];
    rawRecords = [latestLog];
    rawVersion.value += 1;
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual([
      "nat-2",
      "network-2",
      "nat-1",
      "network-1",
    ]);

    filters.category = ["AZFWNatRule"];
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["nat-2", "nat-1"]);

    filters.category = [];
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual([
      "nat-2",
      "network-2",
      "nat-1",
      "network-1",
    ]);

    filters.search = "";
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["latest"]);

    filters.category = ["azfwnatrule"];
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["nat-2", "nat-1"]);
  });

  it("discards retained matches when the live dataset is cleared", async () => {
    const oldNat = createLog({
      id: "old-nat",
      category: "AZFWNatRule",
      searchableText: "azfwnatrule 131.189.255.123",
    });
    const logs = ref([oldNat]);
    let rawRecords: FirewallLogRecord[] = [oldNat];
    const rawVersion = ref(0);
    const { filteredLogs, filters } = useLogQuery(logs, {
      rawSource: { getRecords: () => rawRecords, version: rawVersion },
      visibleLimit: ref(10),
    });

    filters.search = "131.189.255.123";
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["old-nat"]);

    logs.value = [];
    rawRecords = [];
    rawVersion.value += 1;
    await nextTick();

    filters.search = "";
    filters.category = ["AZFWNatRule"];
    await nextTick();
    expect(filteredLogs.value).toEqual([]);
  });

  it("discards retained matches when the hidden live dataset is cleared", async () => {
    const active = ref(true);
    const oldNat = createLog({
      id: "old-nat",
      category: "AZFWNatRule",
      searchableText: "azfwnatrule 131.189.255.123",
    });
    const latestApplication = createLog({
      id: "latest-application",
      category: "AZFWApplicationRule",
      searchableText: "azfwapplicationrule latest",
    });
    const logs = ref([oldNat]);
    let rawRecords: FirewallLogRecord[] = [oldNat];
    const rawVersion = ref(0);
    const getRecords = vi.fn<() => FirewallLogRecord[]>(() => rawRecords);
    const { filteredLogs, filters } = useLogQuery(logs, {
      active,
      rawSource: { getRecords, version: rawVersion },
      visibleLimit: ref(10),
    });

    filters.category = ["AZFWNatRule"];
    await nextTick();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["old-nat"]);

    active.value = false;
    logs.value = [];
    rawRecords = [];
    rawVersion.value += 1;
    await nextTick();
    const callsAfterClear = getRecords.mock.calls.length;

    rawRecords = [latestApplication];
    active.value = true;
    await nextTick();

    expect(getRecords).toHaveBeenCalledTimes(callsAfterClear + 1);
    expect(filteredLogs.value).toEqual([]);
  });

  it("does not scan hidden datasets and catches up when reactivated", async () => {
    const active = ref(false);
    const logs = ref([createLog({ id: "first", protocol: "TCP", searchableText: "tcp" })]);
    const getRecords = vi.fn(() => logs.value);
    const { filteredLogs, filters } = useLogQuery(logs, {
      active,
      rawSource: { getRecords, version: ref(0) },
      visibleLimit: ref(10),
    });
    filters.protocol = "tcp";
    await nextTick();

    expect(getRecords).not.toHaveBeenCalled();
    expect(filteredLogs.value).toEqual([]);

    logs.value = [createLog({ id: "latest", protocol: "TCP", searchableText: "tcp" })];
    active.value = true;
    await nextTick();

    expect(getRecords).toHaveBeenCalledOnce();
    expect(filteredLogs.value.map((log) => log.id)).toEqual(["latest"]);
  });
});
