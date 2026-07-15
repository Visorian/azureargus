import { createDnsDetailSelector, createDnsEntries, parseDnsObservation } from "#shared/utils/dns";

const EVENT_HUB_DNS_REQUEST =
  "DNS Request: 10.140.16.133:29135 - 50772 A IN winatp-gw-neu3.microsoft.com. udp 57 false 1232 NOERROR qr,rd,ra 336 0.0032s";

function input(overrides: Partial<Parameters<typeof parseDnsObservation>[0]> = {}) {
  return {
    id: "dns-1",
    timestamp: "2026-07-12T16:36:42.076Z",
    category: "AZFWDnsQuery",
    action: "DNS query",
    protocol: "UDP",
    message: "",
    raw: {
      category: "AZFWDnsQuery",
      resourceId:
        "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
      properties: {
        SourceIp: "10.0.0.4",
        SourcePort: 53_000,
        QueryId: 42,
        QueryName: "missing.example.",
        QueryType: "HTTPS",
        QueryClass: "IN",
        Protocol: "udp",
        ResponseCode: "NXDOMAIN",
        ResponseFlags: "qr,rd,ra,cd",
        RequestDurationSecs: 0.000_038,
      },
    },
    resourceId:
      "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
    origin: "log-analytics" as const,
    ...overrides,
  };
}

describe("DNS parser", () => {
  it("parses retained structured Log Analytics query fields and DNS errors", () => {
    const observation = parseDnsObservation(input());

    expect(observation).toMatchObject({
      source: "proxy-structured",
      stage: "proxy-exchange",
      clientIp: "10.0.0.4",
      clientPort: "53000",
      queryId: "42",
      queryName: "missing.example.",
      queryType: "HTTPS",
      queryClass: "IN",
      protocol: "UDP",
      responseCode: "NXDOMAIN",
      responseFlags: ["qr", "rd", "ra", "cd"],
      durationSeconds: 0.000_038,
      outcome: "dns-error",
    });
  });

  it("does not map structured DNS queries delivered through Event Hub", () => {
    expect(parseDnsObservation(input({ origin: "event-hub" }))).toBeUndefined();
  });

  it("maps Event Hub DNS proxy requests into active named entries", () => {
    const observation = parseDnsObservation(
      input({
        category: "AzureFirewallDnsProxy",
        origin: "event-hub",
        message: EVENT_HUB_DNS_REQUEST,
        enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
        raw: {
          category: "AzureFirewallDnsProxy",
          properties: { msg: EVENT_HUB_DNS_REQUEST },
        },
      }),
    );

    expect(observation).toMatchObject({
      source: "dns-proxy",
      stage: "proxy-exchange",
      path: "proxy",
      clientIp: "10.140.16.133",
      clientPort: "29135",
      queryId: "50772",
      queryName: "winatp-gw-neu3.microsoft.com.",
      queryType: "A",
      queryClass: "IN",
      protocol: "UDP",
      requestSizeBytes: 57,
      dnssecOk: false,
      ednsBufferSizeBytes: 1232,
      responseCode: "NOERROR",
      responseFlags: ["qr", "rd", "ra"],
      responseSizeBytes: 336,
      durationSeconds: 0.0032,
      outcome: "response-unknown",
      parseState: "parsed",
      enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
      raw: { msg: EVENT_HUB_DNS_REQUEST },
    });
    expect(createDnsEntries([observation!])).toMatchObject([
      {
        source: "dns-proxy",
        displayText: "winatp-gw-neu3.microsoft.com.",
        queryName: "winatp-gw-neu3.microsoft.com.",
        completeness: "complete",
        observations: [{ enqueuedTimeUtc: "2026-07-12T16:36:43.000Z" }],
      },
    ]);
  });

  it.each([
    "DNS Request: malformed",
    `DNS Request: ${"x".repeat(20_000)}`,
    "unrelated diagnostic text",
  ])("does not create blank DNS entries for malformed or oversized proxy message", (message) => {
    expect(
      parseDnsObservation(
        input({
          category: "AzureFirewallDnsProxy",
          origin: "event-hub",
          message,
          raw: { category: "AzureFirewallDnsProxy", properties: { msg: message } },
        }),
      ),
    ).toBeUndefined();
  });

  it("preserves documented DNS Flow Trace fields without inferring message semantics", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWDnsFlowTrace",
        protocol: "TCP",
        raw: {
          MsgType: "future message type",
          Protocol: "TCP",
          QueryMessage: "opaque query details for example.test",
          QueryTime: "2026-07-12T16:36:42.000Z",
          ResponseTime: "2026-07-12T16:36:42.012Z",
          ServerIp: "168.63.129.16",
          ServerMessage: "opaque server response",
          ServerPort: 53,
          SocketFamily: "IPv4",
          SourceIp: "10.0.0.4",
          SourcePort: 53_000,
        },
      }),
    );

    expect(observation).toMatchObject({
      source: "dns-flow-trace",
      stage: "dns-flow-trace",
      path: "proxy",
      outcome: "pending",
      parseState: "partial",
      protocol: "TCP",
      clientIp: "10.0.0.4",
      clientPort: "53000",
      serverIp: "168.63.129.16",
      serverPort: "53",
      msgType: "future message type",
      queryMessage: "opaque query details for example.test",
      serverMessage: "opaque server response",
      queryTime: "2026-07-12T16:36:42.000Z",
      responseTime: "2026-07-12T16:36:42.012Z",
      socketFamily: "IPv4",
    });
    expect(observation?.queryName).toBeUndefined();
    expect(createDnsEntries([observation!])).toMatchObject([
      {
        source: "dns-flow-trace",
        completeness: "partial",
        detailSelector: {
          msgType: "future message type",
          queryMessage: "opaque query details for example.test",
          serverMessage: "opaque server response",
        },
      },
    ]);
  });

  it("maps internal firewall FQDN resolution failures without implying a client query", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWInternalFqdnResolutionFailure",
        protocol: "Unknown",
        policy: "hub-policy",
        ruleCollectionGroup: "hub-group",
        ruleCollection: "application-rules",
        rule: "allow-service",
        raw: {
          Fqdn: "service.example.test",
          Error: "resolver timed out",
          ServerIp: "168.63.129.16",
          ServerPort: 53,
        },
      }),
    );

    expect(observation).toMatchObject({
      source: "internal-fqdn-failure",
      stage: "internal-resolution",
      path: "internal",
      queryName: "service.example.test",
      serverIp: "168.63.129.16",
      serverPort: "53",
      errorMessage: "resolver timed out",
      policy: "hub-policy",
      ruleCollectionGroup: "hub-group",
      ruleCollection: "application-rules",
      rule: "allow-service",
      outcome: "dns-error",
      parseState: "parsed",
    });
    expect(observation?.clientIp).toBeUndefined();
    expect(createDnsEntries([observation!])).toMatchObject([
      {
        source: "internal-fqdn-failure",
        queryName: "service.example.test",
        completeness: "partial",
        detailSelector: {
          queryName: "service.example.test",
          errorMessage: "resolver timed out",
          serverIp: "168.63.129.16",
          serverPort: "53",
        },
      },
    ]);
  });

  it.each(["AZFWDnsFlowTrace", "AZFWInternalFqdnResolutionFailure"])(
    "does not map Log Analytics-only %s records from Event Hub",
    (category) => {
      expect(parseDnsObservation(input({ category, origin: "event-hub" }))).toBeUndefined();
    },
  );

  it("treats unknown nonzero response codes conservatively as DNS errors", () => {
    const observation = parseDnsObservation(
      input({ raw: { QueryName: "future.example.", ResponseCode: "FUTURE_RCODE" } }),
    );

    expect(observation?.outcome).toBe("dns-error");
  });

  it.each([
    {
      sourcePort: "53000",
      destinationPort: "53",
      action: "Allow",
      clientIp: "10.0.0.4",
      clientPort: "53000",
      serverIp: "10.0.0.5",
      serverPort: "53",
      outcome: "transport-observed",
    },
    {
      sourcePort: "53",
      destinationPort: "53000",
      action: "Deny",
      clientIp: "10.0.0.5",
      clientPort: "53000",
      serverIp: "10.0.0.4",
      serverPort: "53",
      outcome: "blocked",
    },
  ])(
    "normalizes TCP DNS direction when exactly one endpoint uses port 53",
    ({
      sourcePort,
      destinationPort,
      action,
      clientIp,
      clientPort,
      serverIp,
      serverPort,
      outcome,
    }) => {
      const observation = parseDnsObservation(
        input({
          category: "AZFWNetworkRule",
          origin: "event-hub",
          action,
          protocol: "TCP",
          sourceIp: "10.0.0.4",
          sourcePort,
          destinationIp: "10.0.0.5",
          destinationPort,
        }),
      );

      expect(observation).toMatchObject({
        source: "network-rule",
        protocol: "TCP",
        clientIp,
        clientPort,
        serverIp,
        serverPort,
        networkSourceIp: "10.0.0.4",
        networkSourcePort: sourcePort,
        networkDestinationIp: "10.0.0.5",
        networkDestinationPort: destinationPort,
        outcome,
      });
      expect(createDnsDetailSelector(observation!)).not.toHaveProperty("logAnalyticsStorage");
    },
  );

  it("keeps both-port-53 transport orientation without assigning client and server roles", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWNetworkRule",
        origin: "event-hub",
        action: "Allow",
        protocol: "UDP",
        sourceIp: "10.0.0.4",
        sourcePort: "53",
        destinationIp: "10.0.0.5",
        destinationPort: "53",
      }),
    );

    expect(observation).toMatchObject({
      networkSourceIp: "10.0.0.4",
      networkSourcePort: "53",
      networkDestinationIp: "10.0.0.5",
      networkDestinationPort: "53",
      warnings: ["DNS transport direction is ambiguous"],
    });
    expect(observation?.clientIp).toBeUndefined();
    expect(observation?.clientPort).toBeUndefined();
    expect(observation?.serverIp).toBeUndefined();
    expect(observation?.serverPort).toBeUndefined();
  });

  it("preserves network-rule metadata and Event Hub enqueue time", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWNetworkRule",
        origin: "event-hub",
        action: "Allow",
        protocol: "UDP",
        sourceIp: "10.0.0.4",
        sourcePort: "53000",
        destinationIp: "168.63.129.16",
        destinationPort: "53",
        enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
        policy: "hub-policy",
        ruleCollectionGroup: "hub-group",
        ruleCollection: "dns-rules",
        rule: "allow-dns",
      }),
    );

    expect(observation).toMatchObject({
      enqueuedTimeUtc: "2026-07-12T16:36:43.000Z",
      policy: "hub-policy",
      ruleCollectionGroup: "hub-group",
      ruleCollection: "dns-rules",
      rule: "allow-dns",
    });
  });

  it("keeps transport observations outside queried entries", () => {
    const query = parseDnsObservation(input());
    const transport = parseDnsObservation(
      input({
        id: "transport-1",
        category: "AZFWNetworkRule",
        origin: "event-hub",
        protocol: "UDP",
        sourcePort: "53000",
        destinationPort: "53",
      }),
    );

    expect(createDnsEntries([query!, transport!])).toHaveLength(1);
    expect(createDnsEntries([query!, transport!])[0]?.id).toBe("dns-1");
  });

  it("does not classify unrelated network records as DNS", () => {
    expect(
      parseDnsObservation(
        input({
          category: "AZFWNetworkRule",
          origin: "event-hub",
          protocol: "TCP",
          sourcePort: "50000",
          destinationPort: "443",
        }),
      ),
    ).toBeUndefined();
  });

  it("marks oversized retained structured values as truncated", () => {
    const longName = `${"a".repeat(1_100)}.example.`;
    const observation = parseDnsObservation(
      input({
        raw: {
          QueryName: longName,
          ErrorMessage: "x".repeat(3_000),
          ErrorNumber: "1".repeat(100),
          ResponseCode: "SERVFAIL",
        },
      }),
    );

    expect(observation?.queryName).toHaveLength(1_024);
    expect(observation?.errorMessage).toHaveLength(2_048);
    expect(observation?.errorNumber).toHaveLength(64);
    expect(observation?.outcome).toBe("transport-error");
    expect(observation?.warnings).toEqual(
      expect.arrayContaining([
        "Query name truncated",
        "Error message truncated",
        "Error number truncated",
      ]),
    );
  });
});
