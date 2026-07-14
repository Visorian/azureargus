import { effectScope, nextTick, reactive, ref } from "vue";

import { useDnsTroubleshooting } from "../../app/composables/useDnsTroubleshooting";
import { normalizeFirewallLogRecord } from "../../app/composables/useFirewallLogParser";
import type { NormalizedLogBatchSink } from "../../app/composables/useEventHubReceiver";
import type {
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsEntry,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsObservation,
} from "../../shared/types/dns";

function createEntry(id: string, queryName = `${id}.example.`): DnsEntry {
  return {
    id,
    timestamp: "2026-07-12T08:30:00.000Z",
    queryName,
    queryType: "A",
    client: "10.0.0.4:53000",
    protocol: "UDP",
    path: "proxy",
    outcome: "response-unknown",
    observationCount: 0,
    completeness: "complete",
    confidence: "explicit",
    source: "proxy-structured",
    warnings: [],
    observations: [],
    detailSelector: {
      source: "proxy-structured",
      resourceId:
        "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
      timestamp: "2026-07-12T08:30:00.000Z",
      queryId: id,
    },
  };
}

function createResponse(...entries: DnsEntry[]): DnsListQueryResponse {
  return {
    queriedEntries: entries,
    transportObservations: [],
    queriedEntriesTruncated: false,
    transportObservationsTruncated: false,
    sources: [],
  };
}

function createTransport(): DnsObservation {
  return {
    id: "transport",
    timestamp: "2026-07-12T08:31:00.000Z",
    source: "network-rule",
    stage: "transport",
    path: "direct",
    outcome: "transport-observed",
    clientIp: "10.0.0.4",
    clientPort: "53000",
    serverIp: "168.63.129.16",
    serverPort: "53",
    protocol: "UDP",
    parseState: "parsed",
    warnings: [],
    raw: {},
    responseFlags: [],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createHarness(
  requestList: (body: DnsListQueryRequest, signal: AbortSignal) => Promise<DnsListQueryResponse>,
  requestDetail: (
    body: DnsDetailQueryRequest,
    signal: AbortSignal,
  ) => Promise<DnsDetailQueryResponse> = async () => ({
    observations: [],
    detailTruncated: false,
    completeness: "complete",
    warnings: [],
  }),
) {
  const active = ref(true);
  const mode = ref<"real-time-analysis" | "log-analysis">("log-analysis");
  const draftRange = reactive({ from: "2026-07-12T08:00", to: "2026-07-12T09:00" });
  const queryLimit = ref(1_000);
  const removeSink = vi.fn<() => boolean>(() => true);
  const sinkHolder: { current?: NormalizedLogBatchSink } = {};
  const scope = effectScope();
  const dns = scope.run(() =>
    useDnsTroubleshooting({
      active,
      draftRange,
      mode,
      queryLimit,
      receiver: {
        addNormalizedBatchSink: (nextSink) => {
          sinkHolder.current = nextSink;
          return removeSink;
        },
      },
      requestDetail,
      requestList,
    }),
  );
  if (!dns) throw new Error("DNS composable was not created.");
  function getSink() {
    if (!sinkHolder.current) throw new Error("DNS sink was not registered.");
    return sinkHolder.current;
  }
  return { active, dns, draftRange, mode, queryLimit, removeSink, scope, getSink };
}

describe("DNS troubleshooting client", () => {
  it("runs and applies server filters only through explicit actions", async () => {
    const requests: DnsListQueryRequest[] = [];
    const harness = createHarness(async (body) => {
      requests.push(body);
      return createResponse(createEntry(`entry-${requests.length}`));
    });

    expect(requests).toEqual([]);
    expect(harness.dns.canApplyFilters.value).toBe(false);
    await harness.dns.run();
    expect(requests).toHaveLength(1);
    expect(requests[0]?.limit).toBe(1_000);
    expect(harness.dns.canApplyFilters.value).toBe(true);
    expect(harness.dns.entries.value).toHaveLength(1);

    harness.dns.filters.value.search = "missing";
    harness.dns.sort.value.key = "queryName";
    harness.queryLimit.value = 2_000;
    await nextTick();
    expect(harness.dns.entries.value).toEqual([]);
    expect(requests).toHaveLength(1);

    await harness.dns.applyFilters();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.filters.search).toBe("missing");
    expect(requests[1]?.limit).toBe(2_000);

    harness.mode.value = "real-time-analysis";
    await nextTick();
    expect(harness.dns.filters.value.search).toBe("");
    expect(harness.dns.sort.value.key).toBe("timestamp");
    harness.dns.filters.value.search = "realtime";
    harness.dns.sort.value.key = "duration";
    harness.mode.value = "log-analysis";
    await nextTick();
    expect(harness.dns.filters.value.search).toBe("missing");
    expect(harness.dns.sort.value.key).toBe("queryName");

    harness.dns.showUnidentifiedTransports.value = true;
    harness.dns.resetFilters();
    expect(harness.dns.showUnidentifiedTransports.value).toBe(false);

    harness.scope.stop();
    expect(harness.removeSink).toHaveBeenCalledOnce();
  });

  it("keeps only latest response and rejects assignment after lens deactivation", async () => {
    const first = createDeferred<DnsListQueryResponse>();
    const second = createDeferred<DnsListQueryResponse>();
    let index = 0;
    const harness = createHarness(() => [first, second][index++]!.promise);

    const firstRun = harness.dns.run();
    const secondRun = harness.dns.run();
    second.resolve(createResponse(createEntry("latest")));
    await secondRun;
    first.resolve(createResponse(createEntry("stale")));
    await firstRun;
    expect(harness.dns.entries.value.map((entry) => entry.id)).toEqual(["latest"]);

    const inactive = createDeferred<DnsListQueryResponse>();
    const inactiveHarness = createHarness(() => inactive.promise);
    const inactiveRun = inactiveHarness.dns.run();
    inactiveHarness.active.value = false;
    await nextTick();
    inactive.resolve(createResponse(createEntry("inactive")));
    await inactiveRun;
    expect(inactiveHarness.dns.entries.value).toEqual([]);

    harness.scope.stop();
    inactiveHarness.scope.stop();
  });

  it("aborts active list work when shared draft range changes", async () => {
    let signal: AbortSignal | undefined;
    const harness = createHarness(
      (_body, requestSignal) =>
        new Promise((_resolve, reject) => {
          signal = requestSignal;
          requestSignal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );

    const run = harness.dns.run();
    harness.draftRange.from = "2026-07-12T08:15";
    await nextTick();

    await expect(run).resolves.toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(harness.dns.status.value).toBe("idle");
    expect(harness.dns.lastError.value).toBeNull();
    harness.scope.stop();
  });

  it("closes stale detail when list results are replaced", async () => {
    let response = createResponse(createEntry("first"));
    const harness = createHarness(async () => response);
    await harness.dns.run();
    await harness.dns.selectEntry(harness.dns.entries.value[0]!);
    expect(harness.dns.selectedEntry.value?.id).toBe("first");

    response = createResponse(createEntry("second"));
    await harness.dns.run();

    expect(harness.dns.selectedEntry.value).toBeNull();
    expect(harness.dns.entries.value.map((entry) => entry.id)).toEqual(["second"]);
    harness.scope.stop();
  });

  it("keeps remote detail empty while loading and assigns only completed response", async () => {
    const detailRequest = createDeferred<DnsDetailQueryResponse>();
    const harness = createHarness(
      async () => createResponse(createEntry("remote")),
      () => detailRequest.promise,
    );
    await harness.dns.run();

    const selection = harness.dns.selectEntry(harness.dns.entries.value[0]!);
    expect(harness.dns.selectedEntry.value?.id).toBe("remote");
    expect(harness.dns.detailStatus.value).toBe("loading");
    expect(harness.dns.detail.value).toBeNull();

    detailRequest.resolve({
      observations: [createTransport()],
      detailTruncated: false,
      completeness: "partial",
      warnings: [],
    });
    await selection;

    expect(harness.dns.detailStatus.value).toBe("success");
    expect(harness.dns.detail.value?.observations).toHaveLength(1);
    harness.scope.stop();
  });

  it("does not leak Log Analytics error status into Real-time DNS", async () => {
    const harness = createHarness(async () => {
      throw new Error("Log Analytics failed");
    });
    await harness.dns.run();
    expect(harness.dns.lastError.value).toBe("Log Analytics failed");
    expect(harness.dns.status.value).toBe("error");

    harness.mode.value = "real-time-analysis";
    await nextTick();

    expect(harness.dns.lastError.value).toBeNull();
    expect(harness.dns.status.value).toBe("idle");
    harness.scope.stop();
  });

  it("matches select-backed filters exactly", async () => {
    const harness = createHarness(async () =>
      createResponse(createEntry("a", "a.example."), {
        ...createEntry("aaaa", "aaaa.example."),
        queryType: "AAAA",
      }),
    );
    await harness.dns.run();

    harness.dns.filters.value.queryType = "A";
    await nextTick();

    expect(harness.dns.entries.value.map((entry) => entry.id)).toEqual(["a"]);
    harness.scope.stop();
  });

  it("merges enabled unidentified transport into sorted partial DNS activity", async () => {
    const transport = createTransport();
    const harness = createHarness(async () => ({
      ...createResponse(createEntry("named")),
      transportObservations: [transport],
    }));
    await harness.dns.run();

    expect(harness.dns.entries.value.map((item) => item.id)).toEqual(["named"]);
    harness.dns.showUnidentifiedTransports.value = true;
    await nextTick();

    expect(harness.dns.entries.value.map((item) => item.id)).toEqual(["transport", "named"]);
    expect(harness.dns.entries.value[0]).toMatchObject({
      completeness: "partial",
      confidence: "uncorrelated",
      observationCount: 1,
    });
    expect(harness.dns.entries.value[0]).not.toHaveProperty("queryName");

    harness.dns.filters.value.search = "168.63.129.16";
    await nextTick();
    expect(harness.dns.entries.value.map((item) => item.id)).toEqual(["transport"]);
    await harness.dns.selectEntry(harness.dns.entries.value[0]!);
    expect(harness.dns.detail.value).toMatchObject({
      completeness: "partial",
      observations: [transport],
    });

    harness.dns.filters.value.search = "";
    harness.dns.filters.value.queryType = "A";
    await nextTick();
    expect(harness.dns.entries.value.map((item) => item.id)).toEqual(["named"]);
    harness.scope.stop();
  });

  it("keeps named-entry and transport truncation state separate", async () => {
    const harness = createHarness(async () => ({
      ...createResponse(createEntry("entry")),
      transportObservationsTruncated: true,
    }));
    await harness.dns.run();

    expect(harness.dns.entriesTruncated.value).toBe(false);
    expect(harness.dns.transportsTruncated.value).toBe(true);
    expect(harness.dns.truncated.value).toBe(true);
    harness.scope.stop();
  });

  it("coalesces active realtime snapshots on bounded cadence", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness(async () => createResponse());
      harness.mode.value = "real-time-analysis";
      harness.dns.showUnidentifiedTransports.value = true;
      await nextTick();
      const record = normalizeFirewallLogRecord({
        raw: {
          time: "2026-07-12T08:30:00.000Z",
          category: "AZFWNetworkRule",
          properties: {
            Action: "Allow",
            Protocol: "TCP",
            SourceIp: "10.0.0.4",
            SourcePort: 53_000,
            DestinationIp: "168.63.129.16",
            DestinationPort: 53,
          },
        },
        partitionId: "0",
        sequenceNumber: 1,
      });

      harness.getSink().onRecords([record]);
      harness.getSink().onRecords([
        {
          ...record,
          id: `${record.id}-duplicate`,
          dns: record.dns ? { ...record.dns, id: `${record.dns.id}-duplicate` } : undefined,
        },
      ]);
      expect(harness.dns.entries.value).toEqual([]);
      vi.advanceTimersByTime(249);
      expect(harness.dns.entries.value).toEqual([]);
      vi.advanceTimersByTime(1);

      expect(harness.dns.entries.value).toHaveLength(2);
      harness.scope.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("defers hidden realtime snapshots and catches up after lens activation", async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness(async () => createResponse());
      harness.mode.value = "real-time-analysis";
      harness.dns.showUnidentifiedTransports.value = true;
      harness.active.value = false;
      await nextTick();

      harness.getSink().onRecords([
        normalizeFirewallLogRecord({
          raw: {
            time: "2026-07-12T08:30:00.000Z",
            category: "AZFWNetworkRule",
            resourceId:
              "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
            properties: {
              Action: "Allow",
              Protocol: "UDP",
              SourceIp: "10.0.0.4",
              SourcePort: 53_000,
              DestinationIp: "168.63.129.16",
              DestinationPort: 53,
            },
          },
          partitionId: "0",
          sequenceNumber: 1,
        }),
      ]);

      expect(harness.dns.entries.value).toEqual([]);
      harness.active.value = true;
      await nextTick();
      vi.runOnlyPendingTimers();

      expect(harness.dns.entries.value).toEqual([
        expect.objectContaining({
          source: "network-rule",
          outcome: "transport-observed",
          client: "10.0.0.4:53000",
        }),
      ]);
      expect(harness.dns.filterOptions.value.outcomes).toEqual(["transport-observed"]);

      harness.scope.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
