import { createDnsEntries, parseDnsObservation } from "#shared/utils/dns";

const LEGACY_MESSAGE =
  "DNS Request: 192.168.179.30:52338 - 22213 AAAA IN sc1.agt.eu1.thousandeyes.com. udp 57 false 1224 NOERROR qr,rd,ra 300 0.011877665s";

function input(overrides: Partial<Parameters<typeof parseDnsObservation>[0]> = {}) {
  return {
    id: "dns-1",
    timestamp: "2026-07-12T16:36:42.076Z",
    category: "AzureFirewallDnsProxy",
    action: "DNS query",
    protocol: "UDP",
    message: LEGACY_MESSAGE,
    raw: {
      category: "AzureFirewallDnsProxy",
      resourceId:
        "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
      properties: { msg: LEGACY_MESSAGE },
    },
    resourceId:
      "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/fw",
    ...overrides,
  };
}

describe("DNS parser", () => {
  it("decodes supplied legacy proxy transaction", () => {
    const observation = parseDnsObservation(input());

    expect(observation).toMatchObject({
      source: "proxy-legacy",
      stage: "proxy-exchange",
      clientIp: "192.168.179.30",
      clientPort: "52338",
      queryId: "22213",
      queryType: "AAAA",
      queryClass: "IN",
      queryName: "sc1.agt.eu1.thousandeyes.com.",
      protocol: "UDP",
      requestSizeBytes: 57,
      dnssecOk: false,
      ednsBufferSizeBytes: 1224,
      responseCode: "NOERROR",
      responseFlags: ["qr", "rd", "ra"],
      responseSizeBytes: 300,
      durationSeconds: 0.011877665,
      outcome: "response-unknown",
    });
  });

  it("keeps malformed DNS proxy messages visible", () => {
    const observation = parseDnsObservation(input({ message: "DNS Request: malformed" }));

    expect(observation).toMatchObject({
      parseState: "unparsed",
      outcome: "pending",
      warnings: ["Unrecognized AzureFirewallDnsProxy message"],
    });
  });

  it("parses documented legacy proxy transport errors without treating error number as RCODE", () => {
    const observation = parseDnsObservation(
      input({
        message:
          " Error: 2 time.windows.com.reddog.microsoft.com. A: read udp 10.0.1.5:49126->168.63.129.160:53: i/o timeout",
      }),
    );

    expect(observation).toMatchObject({
      errorNumber: "2",
      errorMessage: "read udp 10.0.1.5:49126->168.63.129.160:53: i/o timeout",
      queryName: "time.windows.com.reddog.microsoft.com.",
      queryType: "A",
      outcome: "transport-error",
    });
    expect(observation?.responseCode).toBeUndefined();
  });

  it("parses structured query fields and DNS errors", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWDnsQuery",
        origin: "log-analytics",
        message: "",
        raw: {
          properties: {
            SourceIp: "10.0.0.4",
            SourcePort: 53000,
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
      }),
    );

    expect(observation).toMatchObject({
      source: "proxy-structured",
      clientPort: "53000",
      queryId: "42",
      queryType: "HTTPS",
      responseFlags: ["qr", "rd", "ra", "cd"],
      outcome: "dns-error",
    });
  });

  it("treats unknown nonzero response codes conservatively as DNS errors", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWDnsQuery",
        origin: "log-analytics",
        message: "",
        raw: { QueryName: "future.example.", ResponseCode: "FUTURE_RCODE" },
      }),
    );

    expect(observation?.outcome).toBe("dns-error");
  });

  it.each([
    ["53", "53000", "Allow", "transport-observed"],
    ["53000", "53", "Deny", "blocked"],
  ])(
    "recognizes source and destination port 53",
    (sourcePort, destinationPort, action, outcome) => {
      const observation = parseDnsObservation(
        input({
          category: "AZFWNetworkRule",
          action,
          protocol: "TCP",
          sourceIp: "10.0.0.4",
          sourcePort,
          destinationIp: "10.0.0.5",
          destinationPort,
        }),
      );

      expect(observation).toMatchObject({ source: "network-rule", outcome });
    },
  );

  it("keeps transport observations outside queried entries", () => {
    const proxy = parseDnsObservation(input());
    const transport = parseDnsObservation(
      input({
        id: "transport-1",
        category: "AZFWNetworkRule",
        protocol: "UDP",
        sourcePort: "53000",
        destinationPort: "53",
      }),
    );

    expect(createDnsEntries([proxy!, transport!])).toHaveLength(1);
    expect(createDnsEntries([proxy!, transport!])[0]?.id).toBe("dns-1");
  });

  it("does not classify unrelated network records as DNS", () => {
    expect(
      parseDnsObservation(
        input({
          category: "AZFWNetworkRule",
          protocol: "TCP",
          sourcePort: "50000",
          destinationPort: "443",
        }),
      ),
    ).toBeUndefined();
  });

  it("preserves documented Flow Trace messages and timing without correlating rows", () => {
    const observation = parseDnsObservation(
      input({
        category: "AZFWDnsFlowTrace",
        origin: "log-analytics",
        message: "query payload",
        raw: {
          MsgType: "Forwarder Query",
          QueryMessage: "example.com. IN A",
          QueryTime: "2026-07-12T16:36:42.000Z",
          ServerIp: "168.63.129.16",
          ServerPort: 53,
          SourceIp: "10.0.0.4",
        },
      }),
    );

    expect(observation).toMatchObject({
      source: "flow-trace",
      stage: "forwarder-query",
      queryMessage: "example.com. IN A",
      queryTime: "2026-07-12T16:36:42.000Z",
      serverIp: "168.63.129.16",
      serverPort: "53",
    });
    expect(createDnsEntries([observation!])[0]?.confidence).toBe("uncorrelated");
  });

  it("marks oversized canonical and raw values as truncated", () => {
    const longName = `${"a".repeat(1_100)}.example.`;
    const observation = parseDnsObservation(
      input({
        category: "AZFWDnsQuery",
        origin: "log-analytics",
        message: "",
        raw: {
          QueryName: longName,
          ErrorMessage: "x".repeat(3_000),
          ResponseCode: "SERVFAIL",
        },
      }),
    );

    expect(observation?.queryName).toHaveLength(1_024);
    expect(observation?.errorMessage).toHaveLength(2_048);
    expect(observation?.warnings).toEqual(
      expect.arrayContaining(["Query name truncated", "Error message truncated"]),
    );
  });

  it("bounds canonical error and flow timing fields", () => {
    const structured = parseDnsObservation(
      input({
        category: "AZFWDnsQuery",
        origin: "log-analytics",
        message: "",
        raw: { QueryName: "bounded.example.", ErrorNumber: "1".repeat(100) },
      }),
    );
    const flow = parseDnsObservation(
      input({
        category: "AZFWDnsFlowTrace",
        origin: "log-analytics",
        message: "",
        raw: { MsgType: "Client Query", QueryTime: "x".repeat(300) },
      }),
    );

    expect(structured?.errorNumber).toHaveLength(64);
    expect(structured?.outcome).toBe("transport-error");
    expect(structured?.warnings).toContain("Error number truncated");
    expect(flow?.queryTime).toHaveLength(256);
    expect(flow?.warnings).toContain("Query time truncated");
  });
});
