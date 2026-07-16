import { normalizeFirewallLogRecord } from "../../app/composables/useFirewallLogParser";
import {
  NETWORK_RULE_CORRELATION_WINDOW_MS,
  createNetworkRuleCorrelator,
  getNetworkRuleCorrelationKey,
} from "../../app/utils/networkRuleCorrelation";
import type { FirewallLogRecord } from "../../app/types/firewall";

const resourceId =
  "/SUBSCRIPTIONS/1487A784-5C73-422F-B7A3-FCEA3C426610/RESOURCEGROUPS/OBH-RG-DEW1-NETWORK-001/PROVIDERS/MICROSOFT.NETWORK/AZUREFIREWALLS/OBH-AFW-DEW1-CONNECTIVITY-001";

function normalize(raw: unknown, index = 0) {
  return normalizeFirewallLogRecord({ raw, index, partitionId: "0" });
}

function createUdpPair(timestamp = "2026-07-16T13:24:59.993509+00:00") {
  const structured = normalize({
    time: timestamp,
    resourceId,
    properties: {
      Protocol: "UDP",
      SourceIp: "10.176.207.6",
      SourcePort: 59_805,
      DestinationIp: "10.140.17.5",
      DestinationPort: 53,
      Action: "Deny",
      Policy: "obh-afwp-dew1-001",
      RuleCollectionGroup: "obh-rcg-dew1-Outbound_Rules-001",
      RuleCollection: "Deny_Outbound_Azure",
      Rule: "Deny-Azure",
    },
    category: "AZFWNetworkRule",
  });
  const legacy = normalize(
    {
      time: timestamp,
      resourceId,
      operationName: "AzureFirewallNetworkRuleLog",
      properties: {
        msg: "UDP request from 10.176.207.6:59805 to 10.140.17.5:53. Action: Deny.. Policy: obh-afwp-dew1-001. Rule Collection Group: obh-rcg-dew1-Outbound_Rules-001. Rule Collection: Deny_Outbound_Azure. Rule: Deny-Azure",
      },
      category: "AzureFirewallNetworkRule",
    },
    1,
  );
  return { legacy, structured };
}

function createIcmpPair() {
  const structured = normalize({
    time: "2026-07-16T13:24:46.144237+00:00",
    resourceId,
    properties: {
      Protocol: "ICMP Type=3",
      SourceIp: "10.2.1.6",
      SourcePort: 389,
      DestinationIp: "10.140.4.5",
      DestinationPort: 61_198,
      Action: "Allow",
      ActionReason: "Default Action",
    },
    category: "AZFWNetworkRule",
  });
  const legacy = normalize(
    {
      time: "2026-07-16T13:24:46.144237+00:00",
      resourceId,
      operationName: "AzureFirewallNetworkRuleLog",
      properties: {
        msg: "ICMP Type=3 request from 10.2.1.6:389 to 10.140.4.5:61198. Action: Allow.. ",
      },
      category: "AzureFirewallNetworkRule",
    },
    1,
  );
  return { legacy, structured };
}

function createCorrelator(maxCandidates = 100) {
  const batches: FirewallLogRecord[][] = [];
  const correlator = createNetworkRuleCorrelator({
    maxCandidates: () => maxCandidates,
    onRecords: (records) => batches.push([...records]),
  });
  return { batches, correlator };
}

describe("network rule correlation identity", () => {
  it("matches supplied UDP and ICMP schema pairs without changing delivery identity", () => {
    for (const pair of [createUdpPair(), createIcmpPair()]) {
      expect(getNetworkRuleCorrelationKey(pair.structured)).toBe(
        getNetworkRuleCorrelationKey(pair.legacy),
      );
      expect(pair.structured.id).not.toBe(pair.legacy.id);
    }
  });

  it("preserves source precision below normalized display milliseconds", () => {
    const { structured } = createUdpPair();
    const differentMicrosecond = createUdpPair("2026-07-16T13:24:59.993510+00:00").legacy;

    expect(structured.timestamp).toBe(differentMicrosecond.timestamp);
    expect(getNetworkRuleCorrelationKey(structured)).not.toBe(
      getNetworkRuleCorrelationKey(differentMicrosecond),
    );
  });

  it("rejects incomplete and ambiguous records", () => {
    const { structured } = createIcmpPair();

    expect(getNetworkRuleCorrelationKey({ ...structured, action: "Unknown" })).toBeUndefined();
    expect(getNetworkRuleCorrelationKey({ ...structured, protocol: "Unknown" })).toBeUndefined();
    expect(getNetworkRuleCorrelationKey({ ...structured, sourcePort: undefined })).toBeUndefined();
    expect(
      getNetworkRuleCorrelationKey({ ...structured, category: "AZFWApplicationRule" }),
    ).toBeUndefined();
    expect(
      getNetworkRuleCorrelationKey({
        ...structured,
        raw: { time: "not-a-timestamp" },
      }),
    ).toBeUndefined();
  });

  it("keeps material flow differences out of same correlation group", () => {
    const { structured } = createUdpPair();
    const key = getNetworkRuleCorrelationKey(structured);

    expect(getNetworkRuleCorrelationKey({ ...structured, action: "Allow" })).not.toBe(key);
    expect(getNetworkRuleCorrelationKey({ ...structured, destinationPort: "54" })).not.toBe(key);
    expect(getNetworkRuleCorrelationKey({ ...structured, protocol: "TCP" })).not.toBe(key);
    expect(
      getNetworkRuleCorrelationKey({ ...structured, resourceId: `${resourceId}/other` }),
    ).not.toBe(key);
  });
});

describe("network rule correlator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("prefers structured record when either schema arrives first across batches", () => {
    const pair = createUdpPair();
    const structuredFirst = createCorrelator();
    structuredFirst.correlator.push([pair.structured]);
    vi.advanceTimersByTime(100);
    structuredFirst.correlator.push([pair.legacy]);
    expect(structuredFirst.batches).toEqual([[pair.structured]]);
    structuredFirst.correlator.clear();

    vi.setSystemTime(0);
    const legacyFirst = createCorrelator();
    legacyFirst.correlator.push([pair.legacy]);
    vi.advanceTimersByTime(100);
    legacyFirst.correlator.push([pair.structured]);
    expect(legacyFirst.batches).toEqual([[pair.structured]]);
    legacyFirst.correlator.clear();
  });

  it("emits unmatched legacy records together after correlation window", () => {
    const udp = createUdpPair().legacy;
    const icmp = createIcmpPair().legacy;
    const { batches, correlator } = createCorrelator();

    correlator.push([udp, icmp]);
    expect(batches).toEqual([]);
    vi.advanceTimersByTime(NETWORK_RULE_CORRELATION_WINDOW_MS);

    expect(batches).toEqual([[udp, icmp]]);
    correlator.clear();
  });

  it("drains expired candidates before matching timer-throttled batch", () => {
    const pair = createUdpPair();
    const { batches, correlator } = createCorrelator();

    correlator.push([pair.legacy]);
    vi.setSystemTime(NETWORK_RULE_CORRELATION_WINDOW_MS);
    correlator.push([pair.structured]);

    expect(batches).toEqual([[pair.legacy, pair.structured]]);
    correlator.clear();
  });

  it("preserves same-category and excess one-for-one multiplicity", () => {
    const pair = createUdpPair();
    const structuredDuplicate = { ...pair.structured, id: `${pair.structured.id}-duplicate` };
    const legacyDuplicate = { ...pair.legacy, id: `${pair.legacy.id}-duplicate` };
    const { batches, correlator } = createCorrelator();

    correlator.push([pair.structured, structuredDuplicate]);
    correlator.push([pair.legacy, legacyDuplicate]);

    expect(batches).toEqual([[pair.structured, structuredDuplicate]]);
    correlator.clear();

    const excessLegacy = createCorrelator();
    excessLegacy.correlator.push([pair.legacy, legacyDuplicate]);
    excessLegacy.correlator.push([pair.structured]);
    vi.advanceTimersByTime(NETWORK_RULE_CORRELATION_WINDOW_MS);
    expect(excessLegacy.batches).toEqual([[pair.structured], [legacyDuplicate]]);
    excessLegacy.correlator.clear();
  });

  it("passes non-correlatable records through once per push", () => {
    const { structured } = createUdpPair();
    const application = { ...structured, category: "AZFWApplicationRule" };
    const incomplete = { ...structured, sourcePort: undefined };
    const { batches, correlator } = createCorrelator();

    correlator.push([application, incomplete]);

    expect(batches).toEqual([[application, incomplete]]);
    correlator.clear();
  });

  it("bounds candidates without losing oldest unmatched legacy record", () => {
    const first = createUdpPair().legacy;
    const second = { ...createIcmpPair().legacy, id: "second-legacy" };
    const { batches, correlator } = createCorrelator(1);

    correlator.push([first]);
    correlator.push([second]);
    expect(batches).toEqual([[first]]);

    correlator.flush();
    expect(batches).toEqual([[first], [second]]);
  });

  it("discards oldest structured credit on overflow without losing later legacy", () => {
    const first = createUdpPair();
    const second = createIcmpPair();
    const { batches, correlator } = createCorrelator(1);

    correlator.push([first.structured]);
    correlator.push([second.structured]);
    correlator.push([first.legacy]);
    correlator.flush();

    expect(batches).toEqual([[first.structured], [second.structured], [first.legacy]]);
  });

  it("applies reduced candidate capacity on next batch", () => {
    const first = createUdpPair();
    const second = createIcmpPair();
    const passthrough = { ...first.structured, category: "AZFWApplicationRule" };
    const batches: FirewallLogRecord[][] = [];
    let maximum = 2;
    const correlator = createNetworkRuleCorrelator({
      maxCandidates: () => maximum,
      onRecords: (records) => batches.push([...records]),
    });

    correlator.push([first.legacy, second.structured]);
    maximum = 1;
    correlator.push([passthrough]);
    correlator.push([second.legacy]);
    correlator.flush();

    expect(batches).toEqual([[second.structured], [first.legacy, passthrough]]);
  });

  it("disables holding at zero capacity without dropping records", () => {
    const pair = createUdpPair();
    const { batches, correlator } = createCorrelator(0);

    correlator.push([pair.legacy, pair.structured]);

    expect(batches).toEqual([[pair.legacy, pair.structured]]);
    correlator.clear();
  });

  it("flushes pending legacy records and clear cancels pending output", () => {
    const pair = createUdpPair();
    const flushed = createCorrelator();
    flushed.correlator.push([pair.legacy]);
    flushed.correlator.flush();
    vi.advanceTimersByTime(NETWORK_RULE_CORRELATION_WINDOW_MS);
    expect(flushed.batches).toEqual([[pair.legacy]]);

    const cleared = createCorrelator();
    cleared.correlator.push([pair.legacy]);
    cleared.correlator.clear();
    vi.advanceTimersByTime(NETWORK_RULE_CORRELATION_WINDOW_MS);
    expect(cleared.batches).toEqual([]);
  });

  it("ignores stale scheduled callback after clear", () => {
    const pair = createUdpPair();
    const batches: FirewallLogRecord[][] = [];
    let scheduledCallback: (() => void) | undefined;
    const correlator = createNetworkRuleCorrelator({
      maxCandidates: () => 100,
      onRecords: (records) => batches.push([...records]),
      scheduler: {
        clearTimeout: (handle) => clearTimeout(handle),
        setTimeout: (callback, delayMs) => {
          scheduledCallback = callback;
          return setTimeout(() => undefined, delayMs);
        },
      },
    });

    correlator.push([pair.legacy]);
    correlator.clear();
    scheduledCallback?.();

    expect(batches).toEqual([]);
  });
});
