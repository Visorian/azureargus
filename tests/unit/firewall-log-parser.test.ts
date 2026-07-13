import {
  expandAzureMonitorRecords,
  normalizeFirewallLogRecord,
} from "../../app/composables/useFirewallLogParser";

describe("firewall log parser", () => {
  it("expands Azure Monitor Event Hub records payloads", () => {
    const records = [{ category: "AZFWNetworkRule" }, { category: "AZFWApplicationRule" }];

    expect(expandAzureMonitorRecords({ records })).toEqual(records);
  });

  it("normalizes structured firewall logs", () => {
    const log = normalizeFirewallLogRecord({
      raw: {
        time: "2026-07-09T10:00:00Z",
        category: "AZFWNetworkRule",
        properties: {
          action: "Deny",
          protocol: "TCP",
          sourceIp: "10.0.0.4",
          sourcePort: 44321,
          destinationIp: "20.30.40.50",
          destinationPort: 443,
          policy: "hub-policy",
          ruleCollectionGroup: "hub-collection-group",
          ruleCollection: "blocked",
          rule: "deny-web",
          msg: "Deny TCP from 10.0.0.4:44321 to 20.30.40.50:443",
        },
      },
      partitionId: "0",
      sequenceNumber: 42,
    });

    expect(log.category).toBe("AZFWNetworkRule");
    expect(log.action).toBe("Deny");
    expect(log.protocol).toBe("TCP");
    expect(log.sourceIp).toBe("10.0.0.4");
    expect(log.destinationPort).toBe("443");
    expect(log.policy).toBe("hub-policy");
    expect(log.ruleCollectionGroup).toBe("hub-collection-group");
    expect(log.enqueuedTimeUtc).toBeUndefined();
  });

  it("extracts minimal fields from legacy message logs", () => {
    const log = normalizeFirewallLogRecord({
      raw: {
        category: "AzureFirewallNetworkRule",
        properties: {
          msg: "Action: Allow. TCP request from 192.168.1.10:5050 to 10.1.0.8:443. Policy: legacy-policy. Rule Collection Group: legacy-collection-group. Rule Collection: legacy-collection. Rule: allow-web.",
        },
      },
    });

    expect(log.action).toBe("ALLOW");
    expect(log.protocol).toBe("TCP");
    expect(log.sourceIp).toBe("192.168.1.10");
    expect(log.destinationIp).toBe("10.1.0.8");
    expect(log.policy).toBe("legacy-policy");
    expect(log.ruleCollectionGroup).toBe("legacy-collection-group");
  });

  it("labels legacy Azure Firewall DNS proxy requests as DNS queries", () => {
    const log = normalizeFirewallLogRecord({
      raw: {
        time: "2026-07-12T16:36:42.076008+00:00",
        resourceId:
          "/SUBSCRIPTIONS/1487A784-5C73-422F-B7A3-FCEA3C426610/RESOURCEGROUPS/OBH-RG-DEW1-NETWORK-001/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/OBH-AFW-DEW1-CONNECTIVITY-001",
        operationName: "AzureFirewallDnsProxyLog",
        properties: {
          msg: "DNS Request: 192.168.179.30:52100 - 46151 A IN eu-v20.events.endpoint.security.microsoft.com. udp 74 false 1224 NOERROR qr,rd,ra 390 0.003378648s",
        },
        category: "AzureFirewallDnsProxy",
      },
    });

    expect(log.action).toBe("DNS query");
    expect(log.category).toBe("AzureFirewallDnsProxy");
    expect(log.protocol).toBe("UDP");
    expect(log.sourceIp).toBe("192.168.179.30");
    expect(log.sourcePort).toBe("52100");
    expect(log.resourceId).toContain("/AZUREFIREWALLS/");
    expect(log.dns).toMatchObject({
      queryId: "46151",
      queryName: "eu-v20.events.endpoint.security.microsoft.com.",
      responseSizeBytes: 390,
    });
    expect(log.searchableText).toContain("dns query");
  });

  it("uses EventData-local record index in stable identity", () => {
    const first = normalizeFirewallLogRecord({
      raw: { category: "AZFWNetworkRule" },
      partitionId: "2",
      sequenceNumber: 99,
      offset: "1200",
      index: 700,
      eventRecordIndex: 3,
    });

    expect(first.id).toContain("2:1200:3:");
    expect(first.eventRecordIndex).toBe(3);
    expect(first.offset).toBe("1200");
  });

  it("uses global ingestion index when EventData position metadata is unavailable", () => {
    const raw = {
      time: "2026-07-12T16:36:42.000Z",
      category: "AZFWNetworkRule",
      resourceId:
        "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
    };
    const first = normalizeFirewallLogRecord({ raw, partitionId: "0", index: 10 });
    const second = normalizeFirewallLogRecord({ raw, partitionId: "0", index: 11 });

    expect(first.id).not.toBe(second.id);
    expect(first.id).toContain("0:index-10:10:");
  });

  it("labels structured Azure Firewall DNS query records as DNS queries", () => {
    const log = normalizeFirewallLogRecord({
      raw: {
        time: "2026-07-12T16:31:58.589993+00:00",
        resourceId:
          "/SUBSCRIPTIONS/1487A784-5C73-422F-B7A3-FCEA3C426610/RESOURCEGROUPS/OBH-RG-DEW1-NETWORK-001/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/OBH-AFW-DEW1-CONNECTIVITY-001",
        properties: {
          SourceIp: "192.168.179.30",
          SourcePort: 54487,
          QueryId: 39185,
          QueryType: "A",
          QueryClass: "IN",
          QueryName: "router12.teamviewer.com.",
          Protocol: "udp",
          RequestSize: 52,
          DnssecOkBit: false,
          EDNS0BufferSize: 1224,
          ResponseCode: "NOERROR",
          ResponseFlags: "qr,rd,ra",
          ResponseSize: 344,
          RequestDurationSecs: 0.014257901,
          ErrorNumber: 0,
          ErrorMessage: "",
        },
        category: "AZFWDnsQuery",
      },
    });

    expect(log.action).toBe("DNS query");
    expect(log.category).toBe("AZFWDnsQuery");
    expect(log.protocol).toBe("udp");
    expect(log.sourceIp).toBe("192.168.179.30");
    expect(log.sourcePort).toBe("54487");
    expect(log.dns).toBeUndefined();
    expect(log.searchableText).toContain("dns query");
  });

  it("labels the default network action as the rule when no rule matched", () => {
    const defaultAction = normalizeFirewallLogRecord({
      raw: {
        category: "AZFWNetworkRule",
        properties: {
          ActionReason: "Default Action",
          Rule: "",
        },
      },
    });
    const namedRule = normalizeFirewallLogRecord({
      raw: {
        category: "AZFWNetworkRule",
        properties: {
          ActionReason: "Default Action",
          Rule: "deny-web",
        },
      },
    });

    expect(defaultAction.rule).toBe("Default");
    expect(namedRule.rule).toBe("deny-web");
  });
});
