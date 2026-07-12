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
  });

  it("extracts minimal fields from legacy message logs", () => {
    const log = normalizeFirewallLogRecord({
      raw: {
        category: "AzureFirewallNetworkRule",
        properties: {
          msg: "Action: Allow. TCP request from 192.168.1.10:5050 to 10.1.0.8:443.",
        },
      },
    });

    expect(log.action).toBe("ALLOW");
    expect(log.protocol).toBe("TCP");
    expect(log.sourceIp).toBe("192.168.1.10");
    expect(log.destinationIp).toBe("10.1.0.8");
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
