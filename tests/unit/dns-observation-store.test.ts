import { normalizeFirewallLogRecord } from "../../app/composables/useFirewallLogParser";
import { createDnsObservationStore } from "../../app/utils/dnsObservationStore";

function dnsRecord(id: number) {
  return normalizeFirewallLogRecord({
    raw: {
      time: `2026-07-12T16:36:${String(id).padStart(2, "0")}Z`,
      category: "AzureFirewallDnsProxy",
      resourceId:
        "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
      properties: {
        msg: `DNS Request: 10.0.0.${id}:53000 - ${id} A IN host${id}.example. udp 40 false 1224 NOERROR qr,rd,ra 80 0.001s`,
      },
    },
    partitionId: "0",
    sequenceNumber: id,
  });
}

function transportRecord(id: number) {
  return normalizeFirewallLogRecord({
    raw: {
      time: `2026-07-12T17:36:${String(id).padStart(2, "0")}Z`,
      category: "AZFWNetworkRule",
      properties: {
        Action: "Allow",
        Protocol: "UDP",
        SourceIp: `10.1.0.${id}`,
        SourcePort: 50_000 + id,
        DestinationIp: "168.63.129.16",
        DestinationPort: 53,
      },
    },
    partitionId: "0",
    sequenceNumber: 100 + id,
  });
}

describe("DNS observation store", () => {
  it("updates incrementally and reports evictions", () => {
    const store = createDnsObservationStore(2);

    store.pushRecords([dnsRecord(1)]);
    expect(store.snapshot().entries).toHaveLength(1);
    const result = store.pushRecords([dnsRecord(2), dnsRecord(3)]);

    expect(store.snapshot().entries.map((entry) => entry.queryName)).toEqual([
      "host3.example.",
      "host2.example.",
    ]);
    expect(result.evictedEntryIds).toHaveLength(1);
    expect(result.evictedTransportIds).toEqual([]);
  });

  it("clears retained observations", () => {
    const store = createDnsObservationStore();
    store.pushRecords([dnsRecord(1)]);

    expect(store.clear()).toMatchObject({ entries: [], transports: [] });
  });

  it("keeps named entries when transport capacity is exhausted", () => {
    const store = createDnsObservationStore(2, 2);
    const result = store.pushRecords([
      dnsRecord(1),
      transportRecord(1),
      transportRecord(2),
      transportRecord(3),
    ]);

    expect(store.snapshot().entries.map((entry) => entry.queryName)).toEqual(["host1.example."]);
    expect(store.snapshot().transports).toHaveLength(2);
    expect(result.evictedEntryIds).toEqual([]);
    expect(result.evictedTransportIds).toHaveLength(1);
  });

  it("orders snapshots by event time instead of arrival order", () => {
    const store = createDnsObservationStore();
    const olderEntry = dnsRecord(1);
    const newerEntry = dnsRecord(2);
    const olderTransport = transportRecord(1);
    const newerTransport = transportRecord(2);

    store.pushRecords([newerEntry, olderEntry, newerTransport, olderTransport]);

    expect(store.snapshot().entries.map((entry) => entry.queryName)).toEqual([
      "host2.example.",
      "host1.example.",
    ]);
    expect(store.snapshot().transports.map((observation) => observation.id)).toEqual([
      newerTransport.dns?.id,
      olderTransport.dns?.id,
    ]);
  });
});
