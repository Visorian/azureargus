import { normalizeFirewallLogRecord } from "../../app/composables/useFirewallLogParser";
import { createDnsObservationStore } from "../../app/utils/dnsObservationStore";

function transportRecord(id: number, offset = String(100 + id)) {
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
    offset,
  });
}

function dnsProxyRecord() {
  const message =
    "DNS Request: 10.140.16.133:29135 - 50772 A IN winatp-gw-neu3.microsoft.com. udp 57 false 1232 NOERROR qr,rd,ra 336 0.0032s";
  return normalizeFirewallLogRecord({
    raw: {
      time: "2026-07-12T16:36:01Z",
      category: "AzureFirewallDnsProxy",
      resourceId:
        "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
      properties: {
        msg: message,
      },
    },
    enqueuedTimeUtc: "2026-07-12T16:36:02Z",
    partitionId: "0",
    sequenceNumber: 1,
    offset: "1001",
    applicationProperties: { schemaVersion: "1", diagnosticCategory: "dns" },
  });
}

describe("DNS observation store", () => {
  it("updates retained Event Hub transports incrementally and reports evictions", () => {
    const store = createDnsObservationStore(2, 2);

    store.pushRecords([transportRecord(1)]);
    expect(store.snapshot().transports).toHaveLength(1);
    const result = store.pushRecords([transportRecord(2), transportRecord(3)]);

    expect(store.snapshot().transports.map((observation) => observation.clientIp)).toEqual([
      "10.1.0.3",
      "10.1.0.2",
    ]);
    expect(result.evictedEntryIds).toEqual([]);
    expect(result.evictedTransportIds).toHaveLength(1);
  });

  it("clears retained observations", () => {
    const store = createDnsObservationStore();
    store.pushRecords([transportRecord(1)]);

    expect(store.clear()).toMatchObject({ entries: [], transports: [] });
  });

  it("retains Event Hub DNS proxy requests as active named entries", () => {
    const store = createDnsObservationStore();
    const record = dnsProxyRecord();

    expect(record.dns).toMatchObject({
      source: "dns-proxy",
      queryName: "winatp-gw-neu3.microsoft.com.",
      enqueuedTimeUtc: "2026-07-12T16:36:02.000Z",
    });
    store.pushRecords([record]);

    expect(store.snapshot()).toMatchObject({
      entries: [
        {
          source: "dns-proxy",
          queryName: "winatp-gw-neu3.microsoft.com.",
          observations: [
            {
              source: "dns-proxy",
              enqueuedTimeUtc: "2026-07-12T16:36:02.000Z",
            },
          ],
        },
      ],
      transports: [],
    });
  });

  it("deduplicates redelivery identity but preserves distinct Event Hub offsets", () => {
    const store = createDnsObservationStore();
    const delivered = transportRecord(1, "101");
    const distinctDelivery = transportRecord(1, "102");

    store.pushRecords([delivered, delivered, distinctDelivery]);

    expect(store.snapshot().transports).toHaveLength(2);
    expect(new Set(store.snapshot().transports.map((observation) => observation.id))).toEqual(
      new Set([delivered.dns?.id, distinctDelivery.dns?.id]),
    );
  });

  it("orders snapshots by event time instead of arrival order", () => {
    const store = createDnsObservationStore();
    const olderTransport = transportRecord(1);
    const newerTransport = transportRecord(2);

    store.pushRecords([newerTransport, olderTransport]);

    expect(store.snapshot().transports.map((observation) => observation.id)).toEqual([
      newerTransport.dns?.id,
      olderTransport.dns?.id,
    ]);
  });
});
