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

  it("maps live Event Hub DNS proxy requests and preserves delivery metadata", () => {
    const message =
      "DNS Request: 10.140.16.133:29135 - 50772 A IN winatp-gw-neu3.microsoft.com. udp 57 false 1232 NOERROR qr,rd,ra 336 0.0032s";
    const applicationProperties = { schemaVersion: "1", diagnosticCategory: "dns" };
    const log = normalizeFirewallLogRecord({
      raw: {
        time: "2026-07-12T16:36:42.076008+00:00",
        resourceId:
          "/SUBSCRIPTIONS/1487A784-5C73-422F-B7A3-FCEA3C426610/RESOURCEGROUPS/OBH-RG-DEW1-NETWORK-001/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/OBH-AFW-DEW1-CONNECTIVITY-001",
        operationName: "AzureFirewallDnsProxyLog",
        properties: {
          msg: message,
        },
        category: "AzureFirewallDnsProxy",
      },
      enqueuedTimeUtc: new Date("2026-07-12T16:36:43.000Z"),
      partitionId: "2",
      sequenceNumber: 99,
      offset: "1200",
      applicationProperties,
    });

    expect(log.action).toBe("DNS query");
    expect(log.category).toBe("AzureFirewallDnsProxy");
    expect(log.protocol).toBe("UDP");
    expect(log.sourceIp).toBe("10.140.16.133");
    expect(log.sourcePort).toBe("29135");
    expect(log.resourceId).toContain("/AZUREFIREWALLS/");
    expect(log).toMatchObject({
      enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
      applicationProperties,
      partitionId: "2",
      sequenceNumber: "99",
      offset: "1200",
      dns: {
        source: "dns-proxy",
        stage: "proxy-exchange",
        queryId: "50772",
        queryName: "winatp-gw-neu3.microsoft.com.",
        queryType: "A",
        queryClass: "IN",
        protocol: "UDP",
        clientIp: "10.140.16.133",
        clientPort: "29135",
        responseCode: "NOERROR",
        responseFlags: ["qr", "rd", "ra"],
        requestSizeBytes: 57,
        responseSizeBytes: 336,
        durationSeconds: 0.0032,
        enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
        raw: { msg: message },
      },
    });
    expect(log.searchableText).toContain("dns query");
  });

  it("keeps malformed Event Hub DNS proxy records in All logs without a DNS entry", () => {
    const log = normalizeFirewallLogRecord({
      raw: {
        category: "AzureFirewallDnsProxy",
        properties: { msg: "DNS Request: malformed" },
      },
    });

    expect(log.category).toBe("AzureFirewallDnsProxy");
    expect(log.action).toBe("DNS query");
    expect(log.dns).toBeUndefined();
    expect(log.searchableText).toContain("dns request: malformed");
  });

  it("maps retained Event Hub network-rule DNS with transport metadata", () => {
    const applicationProperties = { schemaVersion: "1", diagnosticCategory: "network" };
    const log = normalizeFirewallLogRecord({
      raw: {
        time: "2026-07-12T16:36:42.076Z",
        category: "AZFWNetworkRule",
        resourceId:
          "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
        properties: {
          Action: "Allow",
          Protocol: "TCP",
          SourceIp: "10.0.0.4",
          SourcePort: 53_000,
          DestinationIp: "168.63.129.16",
          DestinationPort: 53,
          Policy: "hub-policy",
          RuleCollectionGroup: "hub-group",
          RuleCollection: "dns-rules",
          Rule: "allow-dns",
        },
      },
      enqueuedTimeUtc: new Date("2026-07-12T16:36:43.000Z"),
      partitionId: "2",
      sequenceNumber: 99,
      offset: "1200",
      applicationProperties,
    });

    expect(log).toMatchObject({
      enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
      applicationProperties,
      partitionId: "2",
      sequenceNumber: "99",
      offset: "1200",
      dns: {
        source: "network-rule",
        protocol: "TCP",
        clientIp: "10.0.0.4",
        clientPort: "53000",
        serverIp: "168.63.129.16",
        serverPort: "53",
        policy: "hub-policy",
        ruleCollectionGroup: "hub-group",
        ruleCollection: "dns-rules",
        rule: "allow-dns",
      },
    });
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
