import type { DnsDetailQueryRequest, DnsListQueryRequest } from "../../shared/types/dns";
import {
  buildDnsDetailQuery,
  buildDnsListQueries,
  buildDnsReadinessProbes,
  executeDnsDetailQuery,
  executeDnsListQuery,
  executeDnsReadinessQuery,
  validateDelegatedDnsDetailQueryRequest,
  validateDelegatedDnsListQueryRequest,
  validateDelegatedDnsReadinessRequest,
  validateDnsDetailQueryRequest,
  validateDnsListQueryRequest,
} from "../../server/utils/dnsLogAnalyticsQuery";

const workspaceId = "33333333-3333-4333-8333-333333333333";
const resourceId =
  "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub";

function createListRequest(): DnsListQueryRequest {
  return {
    from: "2026-07-10T10:00:00.000Z",
    to: "2026-07-10T10:15:00.000Z",
    filters: {
      search: "",
      queryType: "",
      client: "",
      protocol: "",
      outcome: "",
      source: "",
    },
    limit: 1_000,
  };
}

function createDetailRequest(): DnsDetailQueryRequest {
  return {
    selector: {
      source: "proxy-structured",
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      queryId: "22213",
      queryName: "example.com.",
      clientIp: "10.0.0.4",
      clientPort: "52338",
    },
  };
}

function azureResponse(columns: string[], rows: unknown[][]) {
  return {
    tables: [
      {
        name: "PrimaryResult",
        columns: columns.map((name) => ({ name, type: "string" })),
        rows,
      },
    ],
  };
}

function response(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function readinessResponse(sampleCount: 0 | 1 | 2 = 2) {
  return response(azureResponse(["SampleCount"], [[sampleCount]]));
}

describe("DNS Log Analytics request contracts", () => {
  it("keeps managed list requests strict and workspace-free", () => {
    const request = createListRequest();

    expect(validateDnsListQueryRequest(request)).toBe(true);
    expect(validateDnsListQueryRequest({ ...request, workspaceId })).toBe(false);
    expect(validateDnsListQueryRequest({ ...request, from: "2026-07-10" })).toBe(false);
    expect(
      validateDnsListQueryRequest({
        ...request,
        filters: { ...request.filters, search: "x".repeat(257) },
      }),
    ).toBe(false);
  });

  it("allows only a strict UUID workspace on delegated list requests", () => {
    const request = createListRequest();

    expect(validateDelegatedDnsListQueryRequest({ ...request, workspaceId })).toBe(true);
    expect(validateDelegatedDnsListQueryRequest(request)).toBe(false);
    expect(
      validateDelegatedDnsListQueryRequest({ ...request, workspaceId: "caller-workspace" }),
    ).toBe(false);
    expect(
      validateDelegatedDnsListQueryRequest({ ...request, workspaceId, query: "take 100" }),
    ).toBe(false);
  });

  it.each([99, 5_001, 1_000.5, Number.NaN])("rejects invalid list limit %s", (limit) => {
    expect(validateDnsListQueryRequest({ ...createListRequest(), limit })).toBe(false);
  });

  it.each([100, 1_000, 5_000])("accepts bounded list limit %s", (limit) => {
    expect(validateDnsListQueryRequest({ ...createListRequest(), limit })).toBe(true);
  });

  it("validates bounded selectors and keeps managed detail workspace-free", () => {
    const request = createDetailRequest();

    expect(validateDnsDetailQueryRequest(request)).toBe(true);
    expect(validateDnsDetailQueryRequest({ ...request, workspaceId })).toBe(false);
    expect(
      validateDnsDetailQueryRequest({
        selector: { ...request.selector, arbitraryScope: "AZFWApplicationRule" },
      }),
    ).toBe(false);
    expect(
      validateDnsDetailQueryRequest({
        selector: { ...request.selector, resourceId: "not-an-arm-resource-id" },
      }),
    ).toBe(false);
    for (const source of ["flow-trace", "network-rule"] as const) {
      expect(
        validateDnsDetailQueryRequest({
          selector: { ...request.selector, source, queryId: "inapplicable" },
        }),
      ).toBe(false);
      expect(
        validateDnsDetailQueryRequest({
          selector: {
            source,
            resourceId,
            timestamp: request.selector.timestamp,
            clientIp: "10.0.0.4",
            clientPort: "52338",
          },
        }),
      ).toBe(true);
    }
  });

  it("requires workspace only on delegated detail requests", () => {
    const request = createDetailRequest();

    expect(validateDelegatedDnsDetailQueryRequest({ ...request, workspaceId })).toBe(true);
    expect(validateDelegatedDnsDetailQueryRequest(request)).toBe(false);
    expect(validateDelegatedDnsDetailQueryRequest({ ...request, workspaceId, limit: 10_000 })).toBe(
      false,
    );
  });

  it("accepts only an exact delegated readiness workspace", () => {
    expect(validateDelegatedDnsReadinessRequest({ workspaceId })).toBe(true);
    expect(validateDelegatedDnsReadinessRequest({ workspaceId, query: "take 100" })).toBe(false);
    expect(validateDelegatedDnsReadinessRequest({ workspaceId: "not-a-workspace" })).toBe(false);
  });
});

describe("DNS Log Analytics KQL", () => {
  it("uses only allowlisted list sources, early projections, and independent probes", () => {
    const request = createListRequest();
    request.filters.search = 'example.com" | take 9999';
    request.filters.protocol = "UDP";

    const queries = buildDnsListQueries(request);

    expect(queries.map(({ source }) => source)).toEqual([
      "proxy-structured",
      "proxy-legacy",
      "flow-trace",
      "network-rule",
    ]);
    expect(queries.map(({ query }) => query.split("\n")[0])).toEqual([
      "AZFWDnsQuery",
      "AzureDiagnostics",
      "AZFWDnsFlowTrace",
      "AZFWNetworkRule",
    ]);
    expect(queries.every(({ query }) => query.includes("| take 1001"))).toBe(true);
    expect(queries.every(({ query }) => query.includes("| project "))).toBe(true);
    expect(queries.every(({ query }) => !query.includes("\n| take 9999\n"))).toBe(true);
    expect(queries[1]?.query).toContain('| where Category == "AzureFirewallDnsProxy"');
    expect(queries[1]?.query).toContain('| where ResourceProvider =~ "MICROSOFT.NETWORK"');
    expect(queries[1]?.query).toContain('| where ResourceType =~ "AZUREFIREWALLS"');
    expect(queries[1]?.query).toContain('| where tolower(Message) matches regex "\\\\sudp\\\\s"');
    expect(queries[3]?.query).toContain(
      "| where toint(SourcePort) == 53 or toint(DestinationPort) == 53",
    );
  });

  it("uses requested list limit for every source query", () => {
    const request = createListRequest();
    request.limit = 2_500;

    expect(buildDnsListQueries(request).every(({ query }) => query.includes("| take 2501"))).toBe(
      true,
    );
  });

  it("uses unbounded source-specific readiness probes with capped record counts", () => {
    const probes = buildDnsReadinessProbes();

    expect(probes.map(({ sources }) => sources)).toEqual([
      ["proxy-structured"],
      ["proxy-legacy"],
      ["flow-trace"],
      ["network-rule"],
    ]);
    expect(probes.map(({ query }) => query.split("\n")[0])).toEqual([
      "AZFWDnsQuery",
      "AzureDiagnostics",
      "AZFWDnsFlowTrace",
      "AZFWNetworkRule",
    ]);
    expect(probes.every(({ query }) => query.includes("| take 2\n| count"))).toBe(true);
    expect(probes.every(({ query }) => !query.includes("TimeGenerated"))).toBe(true);
    expect(probes[1]?.query).toContain('| where Category == "AzureFirewallDnsProxy"');
    expect(probes[3]?.query).toContain(
      "| where toint(SourcePort) == 53 or toint(DestinationPort) == 53",
    );
  });

  it("uses exact categorical and source-aware canonical outcome filters", () => {
    const structured = createListRequest();
    structured.filters.source = "proxy-structured";
    structured.filters.queryType = "A";
    structured.filters.protocol = "UDP";
    structured.filters.outcome = "response-unknown";

    const [structuredQuery] = buildDnsListQueries(structured);
    expect(structuredQuery?.query).toContain('| where QueryType =~ "A"');
    expect(structuredQuery?.query).toContain('| where Protocol =~ "UDP"');
    expect(structuredQuery?.query).toContain('ResponseCode =~ "NOERROR"');
    expect(structuredQuery?.query).toContain('tostring(ErrorNumber) == "0"');

    const network = createListRequest();
    network.filters.source = "network-rule";
    network.filters.outcome = "blocked";
    const [networkQuery] = buildDnsListQueries(network);
    expect(networkQuery?.query).toContain('| where Action contains "Deny"');

    const legacy = createListRequest();
    legacy.filters.source = "proxy-legacy";
    legacy.filters.outcome = "transport-error";
    const [legacyQuery] = buildDnsListQueries(legacy);
    expect(legacyQuery?.query).toContain(
      '| where trim_start(@"\\s+", Message) startswith "Error:"',
    );
  });

  it("selects one allowlisted detail table and escapes every selector value", () => {
    const request = createDetailRequest();
    request.selector.queryName = 'x" | union AzureActivity';

    const query = buildDnsDetailQuery(request.selector);

    expect(query.split("\n")[0]).toBe("AZFWDnsQuery");
    expect(query).toContain(`| where _ResourceId =~ ${JSON.stringify(resourceId)}`);
    expect(query).toContain(`| where QueryName =~ ${JSON.stringify(request.selector.queryName)}`);
    expect(query).toContain("| take 201");
    expect(query).not.toContain("\n| union AzureActivity");
  });

  it("matches the normalized millisecond without dropping higher-precision timestamps", () => {
    const request = createDetailRequest();

    const query = buildDnsDetailQuery(request.selector);

    expect(query).toContain(
      "| where TimeGenerated >= datetime(2026-07-10T10:01:00.000Z) and TimeGenerated < datetime(2026-07-10T10:01:00.001Z)",
    );
  });

  it("scopes legacy detail to Azure Firewall diagnostics", () => {
    const request = createDetailRequest();
    request.selector.source = "proxy-legacy";

    const query = buildDnsDetailQuery(request.selector);

    expect(query).toContain('| where Category == "AzureFirewallDnsProxy"');
    expect(query).toContain('| where ResourceProvider =~ "MICROSOFT.NETWORK"');
    expect(query).toContain('| where ResourceType =~ "AZUREFIREWALLS"');
  });
});

describe("DNS Log Analytics source mapping", () => {
  it("maps named and transport sources separately and propagates source truncation", async () => {
    const networkColumns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "Action",
      "Protocol",
      "SourceIp",
      "SourcePort",
      "DestinationIp",
      "DestinationPort",
    ];
    const networkRows = Array.from({ length: 1_001 }, (_, index) => [
      `2026-07-10T10:00:${String(index % 60).padStart(2, "0")}.000Z`,
      "AZFWNetworkRule",
      resourceId,
      "Allow",
      "UDP",
      "10.0.0.4",
      String(50_000 + index),
      "10.0.0.5",
      "53",
    ]);
    const structuredColumns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "SourceIp",
      "SourcePort",
      "QueryId",
      "QueryType",
      "QueryClass",
      "QueryName",
      "Protocol",
      "ResponseCode",
      "ResponseFlags",
      "RequestDurationSecs",
    ];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.startsWith("AZFWDnsQuery")) {
        return response(
          azureResponse(structuredColumns, [
            [
              "2026-07-10T10:01:00.000Z",
              "AZFWDnsQuery",
              resourceId,
              "10.0.0.4",
              52338,
              22213,
              "AAAA",
              "IN",
              "example.com.",
              "UDP",
              "NOERROR",
              "qr,rd,ra",
              0.011,
            ],
          ]),
        );
      }
      if (query.startsWith("AZFWNetworkRule")) {
        return response(azureResponse(networkColumns, networkRows));
      }
      return response(azureResponse(["TimeGenerated"], []));
    });

    const result = await executeDnsListQuery({ workspaceId }, createListRequest(), "access-token", {
      fetchImplementation,
      queryId: "query-id",
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(result.queriedEntries).toHaveLength(1);
    expect(result.queriedEntries[0]).toMatchObject({
      queryName: "example.com.",
      source: "proxy-structured",
      detailSelector: { queryId: "22213", resourceId },
      observations: [],
    });
    expect(result.transportObservations).toHaveLength(1_000);
    expect(result.transportObservations[0]).toMatchObject({
      source: "network-rule",
      outcome: "transport-observed",
    });
    expect(result.sources).toContainEqual({
      source: "network-rule",
      availability: "available",
      truncated: true,
    });
    expect(result.queriedEntriesTruncated).toBe(false);
    expect(result.transportObservationsTruncated).toBe(true);
  });

  it("keeps exact zero, one, and two-plus readiness evidence", async () => {
    const sampleCounts = new Map<string, 0 | 1 | 2>([
      ["AZFWDnsQuery", 0],
      ["AzureDiagnostics", 1],
      ["AZFWDnsFlowTrace", 2],
      ["AZFWNetworkRule", 2],
    ] as const);
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      return readinessResponse(sampleCounts.get(query.split("\n")[0]!) ?? 2);
    });

    const result = await executeDnsReadinessQuery({ workspaceId }, "access-token", {
      fetchImplementation,
    });

    expect(result.readiness).toEqual([
      { source: "proxy-structured", status: "success", sampleCount: 0 },
      { source: "proxy-legacy", status: "success", sampleCount: 1 },
      { source: "flow-trace", status: "success", sampleCount: 2 },
      { source: "network-rule", status: "success", sampleCount: 2 },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(4);
    expect(
      fetchImplementation.mock.calls.every(([, init]) => {
        if (typeof init?.body !== "string") return false;
        return !("timespan" in (JSON.parse(init.body) as object));
      }),
    ).toBe(true);
  });

  it("reports readiness authorization and query failures per source", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.startsWith("AzureDiagnostics")) return new Response(null, { status: 403 });
      if (query.startsWith("AZFWDnsFlowTrace")) return new Response(null, { status: 500 });
      return readinessResponse();
    });

    const result = await executeDnsReadinessQuery({ workspaceId }, "access-token", {
      fetchImplementation,
    });

    expect(result.readiness).toContainEqual({
      source: "proxy-legacy",
      status: "forbidden",
      sampleCount: null,
    });
    expect(result.readiness).toContainEqual({
      source: "flow-trace",
      status: "failed",
      sampleCount: null,
    });
  });

  it("keeps successful sources when another source is forbidden", async () => {
    const columns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "SourceIp",
      "SourcePort",
      "QueryId",
      "QueryName",
      "Protocol",
      "ResponseCode",
      "ResponseFlags",
    ];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.includes("| project SampleCount")) return readinessResponse();
      if (query.startsWith("AZFWDnsQuery")) {
        return response(
          azureResponse(columns, [
            [
              "2026-07-10T10:01:00.000Z",
              "AZFWDnsQuery",
              resourceId,
              "10.0.0.4",
              "52338",
              "22213",
              "example.com.",
              "UDP",
              "NOERROR",
              "qr,rd,ra",
            ],
          ]),
        );
      }
      if (query.startsWith("AZFWDnsFlowTrace")) return new Response(null, { status: 403 });
      return response(azureResponse(["TimeGenerated"], []));
    });

    const result = await executeDnsListQuery({ workspaceId }, createListRequest(), "access-token", {
      fetchImplementation,
    });

    expect(result.queriedEntries).toHaveLength(1);
    expect(result.sources).toContainEqual({
      source: "flow-trace",
      availability: "forbidden",
      truncated: false,
      warning: "Source query forbidden",
    });
  });

  it("returns per-source diagnostics when every source probe fails", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "table unavailable" } }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await executeDnsListQuery({ workspaceId }, createListRequest(), "access-token", {
      fetchImplementation,
    });

    expect(result.queriedEntries).toEqual([]);
    expect(result.transportObservations).toEqual([]);
    expect(result.sources).toHaveLength(4);
    expect(result.sources.every((source) => source.availability === "failed")).toBe(true);
  });

  it("requeries one exact bounded detail selector without server list state", async () => {
    const columns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "SourceIp",
      "SourcePort",
      "QueryId",
      "QueryType",
      "QueryClass",
      "QueryName",
      "Protocol",
      "ResponseCode",
      "ResponseFlags",
      "RequestDurationSecs",
    ];
    const row = [
      "2026-07-10T10:01:00.0001234Z",
      "AZFWDnsQuery",
      resourceId,
      "10.0.0.4",
      "52338",
      "22213",
      "AAAA",
      "IN",
      "example.com.",
      "UDP",
      "NOERROR",
      "qr,rd,ra",
      0.011,
    ];
    const listFetch = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.includes("| project SampleCount")) return readinessResponse();
      return response(
        query.startsWith("AZFWDnsQuery")
          ? azureResponse(columns, [row])
          : azureResponse(["TimeGenerated"], []),
      );
    });
    const listed = await executeDnsListQuery({ workspaceId }, createListRequest(), "access-token", {
      fetchImplementation: listFetch,
      queryId: "list",
    });
    const selector = listed.queriedEntries[0]?.detailSelector;
    if (!selector) throw new Error("Expected detail selector");
    const detailFetch = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(azureResponse(columns, [row])));

    const detail = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation: detailFetch,
      queryId: "detail",
    });

    expect(detail).toMatchObject({
      completeness: "complete",
      detailTruncated: false,
      observations: [
        {
          queryId: "22213",
          queryName: "example.com.",
          outcome: "response-unknown",
        },
      ],
      warnings: [],
    });
    expect(detailFetch).toHaveBeenCalledOnce();
  });
});
