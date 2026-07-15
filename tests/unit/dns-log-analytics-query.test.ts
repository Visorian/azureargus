import type {
  DnsDetailQueryRequest,
  DnsListQueryRequest,
  DnsObservation,
} from "../../shared/types/dns";
import {
  assignStableLogAnalyticsRowIds,
  buildDnsDetailQuery,
  buildDnsListQueries,
  buildDnsReadinessProbes,
  buildDnsRelatedEvidenceQueries,
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
    storage: "resource-specific",
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

function readinessResponse(sampleCount: 0 | 1 | 2 = 2, tableExists = true) {
  return response(azureResponse(["TableExists", "SampleCount"], [[tableExists, sampleCount]]));
}

function relatedObservation(overrides: Partial<DnsObservation> = {}): DnsObservation {
  return {
    id: "dns-related",
    timestamp: "2026-07-10T10:01:00.000Z",
    source: "proxy-structured",
    stage: "proxy-exchange",
    path: "proxy",
    outcome: "response-unknown",
    resourceId,
    queryName: "example.com.",
    clientIp: "10.0.0.4",
    clientPort: "52338",
    serverIp: "168.63.129.16",
    serverPort: "53",
    protocol: "TCP",
    responseFlags: [],
    parseState: "parsed",
    warnings: [],
    raw: {},
    ...overrides,
  };
}

describe("DNS Log Analytics request contracts", () => {
  it("keeps managed list requests strict and workspace-free", () => {
    const request = createListRequest();

    expect(validateDnsListQueryRequest(request)).toBe(true);
    expect(validateDnsListQueryRequest({ ...request, storage: "azure-diagnostics" })).toBe(true);
    expect(validateDnsListQueryRequest({ ...request, storage: "AzureDiagnostics" })).toBe(false);
    const { storage: _storage, ...withoutStorage } = request;
    expect(validateDnsListQueryRequest(withoutStorage)).toBe(false);
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
    expect(
      validateDnsDetailQueryRequest({
        selector: { ...request.selector, source: "unknown-source" },
      }),
    ).toBe(false);
    expect(
      validateDnsDetailQueryRequest({
        selector: { ...request.selector, source: "dns-proxy" },
      }),
    ).toBe(false);
    expect(
      validateDnsDetailQueryRequest({
        selector: { ...request.selector, source: "network-rule", queryId: "inapplicable" },
      }),
    ).toBe(false);
    expect(
      validateDnsDetailQueryRequest({
        selector: {
          source: "network-rule",
          resourceId,
          timestamp: request.selector.timestamp,
          logAnalyticsStorage: "resource-specific",
          protocol: "UDP",
          networkSourceIp: "10.0.0.4",
          networkSourcePort: "52338",
          networkDestinationIp: "10.0.0.5",
          networkDestinationPort: "53",
        },
      }),
    ).toBe(true);
    expect(
      validateDnsDetailQueryRequest({
        selector: {
          source: "network-rule",
          resourceId,
          timestamp: request.selector.timestamp,
          logAnalyticsStorage: "AzureDiagnostics",
          protocol: "UDP",
          networkSourceIp: "10.0.0.4",
          networkSourcePort: "52338",
          networkDestinationIp: "10.0.0.5",
          networkDestinationPort: "53",
        },
      }),
    ).toBe(false);
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
  it("uses only resource-specific list sources when selected", () => {
    const request = createListRequest();
    request.filters.search = 'example.com" | take 9999';
    request.filters.protocol = "UDP";

    const queries = buildDnsListQueries(request);

    expect(queries.map(({ source }) => source)).toEqual([
      "proxy-structured",
      "dns-flow-trace",
      "internal-fqdn-failure",
      "network-rule",
    ]);
    expect(queries.map(({ query }) => query.split("\n")[0])).toEqual([
      "AZFWDnsQuery",
      "AZFWDnsFlowTrace",
      "AZFWInternalFqdnResolutionFailure",
      "AZFWNetworkRule",
    ]);
    expect(queries.every(({ storage }) => storage === "resource-specific")).toBe(true);
    expect(queries.every(({ query }) => !query.includes("AzureDiagnostics"))).toBe(true);
    expect(queries.every(({ query }) => query.includes("| take 1001"))).toBe(true);
    expect(
      queries.every(({ query }) => query.includes("| project ") || query.includes("| project\n")),
    ).toBe(true);
    expect(queries.every(({ query }) => !query.includes("\n| take 9999\n"))).toBe(true);
    expect(queries[3]?.query).toContain(
      "| where toint(SourcePort) == 53 or toint(DestinationPort) == 53",
    );
  });

  it("uses only AzureDiagnostics list sources when selected", () => {
    const request = createListRequest();
    request.storage = "azure-diagnostics";

    const queries = buildDnsListQueries(request);

    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      source: "network-rule",
      storage: "azure-diagnostics",
    });
    expect(queries[0]?.query.split("\n")[0]).toBe("AzureDiagnostics");
    expect(queries[0]?.query).toContain('| where ResourceProvider =~ "MICROSOFT.NETWORK"');
    expect(queries[0]?.query).toContain('| where ResourceType =~ "AZUREFIREWALLS"');
    expect(queries[0]?.query).toContain('| where Category == "AZFWNetworkRule"');
    expect(queries[0]?.query).toContain('column_ifexists("Protocol_s", "")');
    expect(queries[0]?.query).not.toContain("\nAZFWNetworkRule\n");
  });

  it("uses requested list limit for every source query", () => {
    const request = createListRequest();
    request.limit = 2_500;

    expect(buildDnsListQueries(request).every(({ query }) => query.includes("| take 2501"))).toBe(
      true,
    );
  });

  it("checks every dedicated table and matching AzureDiagnostics category explicitly", () => {
    const probes = buildDnsReadinessProbes();

    expect(probes.map(({ sources }) => sources)).toEqual([
      ["proxy-structured"],
      ["proxy-structured"],
      ["dns-flow-trace"],
      ["dns-flow-trace"],
      ["internal-fqdn-failure"],
      ["internal-fqdn-failure"],
      ["network-rule"],
      ["network-rule"],
      ["application-rule"],
      ["application-rule"],
      ["flow-trace"],
      ["flow-trace"],
      ["nat-rule"],
      ["nat-rule"],
    ]);
    expect(probes.map(({ storage }) => storage)).toEqual(
      Array.from({ length: 7 }, () => ["resource-specific", "azure-diagnostics"]).flat(),
    );
    expect(probes).toHaveLength(14);
    expect(probes.every(({ query }) => query.includes("union isfuzzy=true MissingTable"))).toBe(
      true,
    );
    expect(probes.every(({ query }) => query.includes("| take 2\n| count"))).toBe(true);
    expect(probes[0]?.query).toContain("\nAZFWDnsQuery\n");
    expect(probes[1]?.query).toContain("\nAzureDiagnostics\n");
    expect(probes[1]?.query).toContain('| where Category == "AZFWDnsQuery"');
    expect(probes[3]?.query).toContain('| where Category == "AZFWDnsAdditional"');
    expect(probes[5]?.query).toContain('| where Category == "AZFWFqdnResolveFailure"');
    expect(probes[7]?.query).toContain('| where Category == "AZFWNetworkRule"');
  });

  it("uses documented DNS Flow Trace fields without inventing query or outcome semantics", () => {
    const request = createListRequest();
    request.filters.source = "dns-flow-trace";
    request.filters.search = 'opaque" | take 9999';
    request.filters.protocol = "UDP";

    const [flow] = buildDnsListQueries(request);

    expect(flow?.query.split("\n")[0]).toBe("AZFWDnsFlowTrace");
    expect(flow?.query).toContain(
      'strcat(MsgType, " ", QueryMessage, " ", ServerMessage, " ", SourceIp, " ", SourcePort, " ", ServerIp, " ", ServerPort)',
    );
    expect(flow?.query).toContain('| where Protocol =~ "UDP"');
    expect(flow?.query).toContain("MsgType, Protocol, QueryMessage, QueryTime, ResponseTime");
    expect(flow?.query).not.toContain("\n| take 9999\n");

    request.filters.queryType = "A";
    expect(buildDnsListQueries(request)[0]?.query).toContain("| where false");
  });

  it("queries internal FQDN failures without ignoring unsupported filters", () => {
    const request = createListRequest();
    request.filters.source = "internal-fqdn-failure";
    request.filters.search = "resolver timed out";
    request.filters.outcome = "dns-error";

    const [internal] = buildDnsListQueries(request);

    expect(internal?.query.split("\n")[0]).toBe("AZFWInternalFqdnResolutionFailure");
    expect(internal?.query).toContain(
      'strcat(Fqdn, " ", Error, " ", ServerIp, " ", ServerPort, " ", Policy, " ", RuleCollectionGroup, " ", RuleCollection, " ", Rule)',
    );
    expect(internal?.query).not.toContain("| where false");
    expect(internal?.query).toContain("Fqdn, Error, ServerIp, ServerPort, Policy");

    request.filters.client = "10.0.0.4";
    expect(buildDnsListQueries(request)[0]?.query).toContain("| where false");
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
    network.filters.client = "10.0.0.4:52338";
    const [networkQuery] = buildDnsListQueries(network);
    expect(networkQuery?.query).toContain('| where Action contains "Deny"');
    expect(networkQuery?.query).toContain(
      'iff(toint(DestinationPort) == 53 and toint(SourcePort) != 53, strcat(SourceIp, ":", SourcePort), iff(toint(SourcePort) == 53 and toint(DestinationPort) != 53, strcat(DestinationIp, ":", DestinationPort), ""))',
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

  it("never maps Event Hub DNS proxy entries to a Log Analytics detail table", () => {
    expect(() =>
      buildDnsDetailQuery({
        ...createDetailRequest().selector,
        source: "dns-proxy",
      }),
    ).toThrow("Event Hub DNS proxy entries do not use Log Analytics detail queries");
  });

  it("matches the normalized millisecond without dropping higher-precision timestamps", () => {
    const request = createDetailRequest();

    const query = buildDnsDetailQuery(request.selector);

    expect(query).toContain(
      "| where TimeGenerated >= datetime(2026-07-10T10:01:00.000Z) and TimeGenerated < datetime(2026-07-10T10:01:00.001Z)",
    );
  });

  it("uses raw network direction fields in network detail selectors", () => {
    const query = buildDnsDetailQuery({
      source: "network-rule",
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      logAnalyticsStorage: "resource-specific",
      protocol: "TCP",
      networkSourceIp: "10.0.0.53",
      networkSourcePort: "53",
      networkDestinationIp: "10.0.0.4",
      networkDestinationPort: "52338",
    });

    expect(query.split("\n")[0]).toBe("AZFWNetworkRule");
    expect(query).toContain('| where Protocol =~ "TCP"');
    expect(query).toContain('| where SourceIp == "10.0.0.53"');
    expect(query).toContain('| where tostring(SourcePort) == "53"');
    expect(query).toContain('| where DestinationIp == "10.0.0.4"');
    expect(query).toContain('| where tostring(DestinationPort) == "52338"');
    expect(query).toContain("Policy, RuleCollectionGroup, RuleCollection, Rule");
  });

  it("routes Azure Diagnostics network details through the fixed normalized projection", () => {
    const query = buildDnsDetailQuery({
      source: "network-rule",
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      logAnalyticsStorage: "azure-diagnostics",
      protocol: "UDP",
      networkSourceIp: "10.0.0.4",
      networkSourcePort: "52338",
      networkDestinationIp: "10.0.0.53",
      networkDestinationPort: "53",
    });

    expect(query.split("\n")[0]).toBe("AzureDiagnostics");
    expect(query).toContain('| where ResourceProvider =~ "MICROSOFT.NETWORK"');
    expect(query).toContain('| where Category == "AZFWNetworkRule"');
    expect(query).toContain('SourceIp = tostring(column_ifexists("SourceIP", ""))');
    expect(query).toContain(`| where ResourceId =~ ${JSON.stringify(resourceId)}`);
    expect(query).not.toContain("AzureFirewallNetworkRule");
  });

  it("uses exact escaped DNS Flow Trace detail anchors", () => {
    const query = buildDnsDetailQuery({
      source: "dns-flow-trace",
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      msgType: 'future" | union AzureActivity',
      queryMessage: "opaque query",
      queryTime: "2026-07-10T10:00:59.999Z",
      clientIp: "10.0.0.4",
      clientPort: "52338",
      serverIp: "168.63.129.16",
      serverPort: "53",
    });

    expect(query.split("\n")[0]).toBe("AZFWDnsFlowTrace");
    expect(query).toContain('| where tostring(MsgType) == "future\\" | union AzureActivity"');
    expect(query).toContain('| where tostring(QueryMessage) == "opaque query"');
    expect(query).toContain('| where tostring(SourceIp) == "10.0.0.4"');
    expect(query).toContain('| where tostring(ServerPort) == "53"');
    expect(query).toContain("| take 201");
    expect(query).not.toContain("\n| union AzureActivity");
  });

  it("uses exact escaped internal FQDN failure detail anchors", () => {
    const query = buildDnsDetailQuery({
      source: "internal-fqdn-failure",
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      queryName: 'example.com" | take 9999',
      errorMessage: "resolver timed out",
      serverIp: "168.63.129.16",
      serverPort: "53",
      policy: "hub-policy",
      ruleCollectionGroup: "hub-group",
      ruleCollection: "application-rules",
      rule: "allow-service",
    });

    expect(query.split("\n")[0]).toBe("AZFWInternalFqdnResolutionFailure");
    expect(query).toContain('| where tostring(Fqdn) =~ "example.com\\" | take 9999"');
    expect(query).toContain('| where tostring(Error) == "resolver timed out"');
    expect(query).toContain('| where tostring(ServerIp) == "168.63.129.16"');
    expect(query).toContain('| where tostring(Rule) == "allow-service"');
    expect(query).not.toContain("\n| take 9999\n");
  });

  it("builds bounded related evidence queries from exact observation anchors", () => {
    const queries = buildDnsRelatedEvidenceQueries(relatedObservation());

    expect(queries.map(({ source }) => source)).toEqual([
      "application-rule",
      "flow-trace",
      "nat-rule",
    ]);
    expect(queries.map(({ query }) => query.split("\n")[0])).toEqual([
      "AZFWApplicationRule",
      "AZFWFlowTrace",
      "AZFWNatRule",
    ]);
    expect(queries.every(({ query }) => query.includes("| take 51"))).toBe(true);
    expect(
      queries.every(({ query }) => query.includes(`| where _ResourceId =~ "${resourceId}"`)),
    ).toBe(true);
    expect(queries.map(({ timespan }) => timespan)).toEqual([
      "2026-07-10T10:00:55.000Z/2026-07-10T10:02:00.000Z",
      "2026-07-10T10:00:55.000Z/2026-07-10T10:01:05.000Z",
      "2026-07-10T10:00:55.000Z/2026-07-10T10:01:05.000Z",
    ]);

    expect(queries[0]?.query).toContain('| where SourceIp == "10.0.0.4"');
    expect(queries[0]?.query).toContain('| where Fqdn in~ ("example.com", "example.com.")');
    expect(queries[1]?.query).toContain('| where Protocol =~ "TCP"');
    expect(queries[1]?.query).toContain("toint(DestinationPort) == 53");
    expect(queries[1]?.query).toContain("toint(SourcePort) == 53");
    expect(queries[2]?.query).toContain('| where Protocol =~ "TCP"');
    expect(queries[2]?.query).toContain(
      "| where toint(DestinationPort) == 53 or toint(TranslatedPort) == 53",
    );
    expect(queries[2]?.query).toContain(
      '| where DestinationIp == "168.63.129.16" or TranslatedIp == "168.63.129.16"',
    );
  });

  it("escapes related anchors and does not broaden queries when anchors are absent", () => {
    const injected = buildDnsRelatedEvidenceQueries(
      relatedObservation({
        queryName: 'example.com" | union AzureActivity',
        clientIp: '10.0.0.4" | take 9999',
      }),
    );

    expect(injected).toHaveLength(3);
    expect(injected.every(({ query }) => !query.includes("\n| union AzureActivity"))).toBe(true);
    expect(injected.every(({ query }) => !query.includes("\n| take 9999\n"))).toBe(true);
    expect(injected.every(({ query }) => query.includes('10.0.0.4\\" | take 9999'))).toBe(true);

    expect(buildDnsRelatedEvidenceQueries(relatedObservation({ resourceId: undefined }))).toEqual(
      [],
    );
    expect(
      buildDnsRelatedEvidenceQueries(
        relatedObservation({ logAnalyticsStorage: "azure-diagnostics" }),
      ),
    ).toEqual([]);
    expect(
      buildDnsRelatedEvidenceQueries(
        relatedObservation({
          queryName: undefined,
          clientIp: undefined,
          clientPort: undefined,
          serverIp: undefined,
        }),
      ),
    ).toEqual([]);
    expect(
      buildDnsRelatedEvidenceQueries(relatedObservation({ protocol: "UDP" })).map(
        ({ source }) => source,
      ),
    ).toEqual(["application-rule", "nat-rule"]);
  });
});

describe("DNS Log Analytics source mapping", () => {
  it("assigns stable row identities across response reordering", () => {
    const rows = [
      { TimeGenerated: "2026-07-10T10:00:00.000Z", QueryName: "first.example." },
      { TimeGenerated: "2026-07-10T10:00:01.000Z", QueryName: "second.example." },
    ];

    const initial = assignStableLogAnalyticsRowIds("proxy-structured", rows);
    const reordered = assignStableLogAnalyticsRowIds("proxy-structured", rows.toReversed());
    const idsByName = (assigned: typeof initial) =>
      Object.fromEntries(assigned.map(({ id, row }) => [row.QueryName, id]));

    expect(idsByName(reordered)).toEqual(idsByName(initial));
    expect(initial.every(({ id }) => id.startsWith("la:proxy-structured:"))).toBe(true);
  });

  it("preserves duplicate multiplicity with deterministic occurrence ordinals", () => {
    const duplicate = {
      TimeGenerated: "2026-07-10T10:00:00.000Z",
      QueryName: "duplicate.example.",
    };

    const assigned = assignStableLogAnalyticsRowIds("proxy-structured", [
      duplicate,
      { ...duplicate },
      { ...duplicate },
    ]);

    expect(new Set(assigned.map(({ id }) => id)).size).toBe(3);
    expect(assigned.map(({ id }) => id.slice(id.lastIndexOf(":")))).toEqual([":1", ":2", ":3"]);
    expect(assigned.every(({ collision }) => !collision)).toBe(true);
  });

  it("separates non-equivalent rows when the identity digest collides", () => {
    const assigned = assignStableLogAnalyticsRowIds(
      "proxy-structured",
      [{ QueryName: "z.example." }, { QueryName: "a.example." }],
      () => "forced-collision",
    );

    expect(assigned.every(({ collision }) => collision)).toBe(true);
    expect(new Set(assigned.map(({ id }) => id)).size).toBe(2);
    expect(assigned.map(({ id }) => id).toSorted()).toEqual([
      "la:proxy-structured:forced-collision:collision-1:1",
      "la:proxy-structured:forced-collision:collision-2:1",
    ]);
  });

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

  it("keeps exact zero, one, and two-plus readiness per source and storage", async () => {
    const sampleCounts: Array<0 | 1 | 2> = [0, 1, 1, 2, 2, 0, 2, 1, 1, 0, 0, 2, 2, 1];
    let requestIndex = 0;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => readinessResponse(sampleCounts[requestIndex++]!));

    const result = await executeDnsReadinessQuery({ workspaceId }, "access-token", {
      fetchImplementation,
    });

    expect(result.readiness.map(({ source, storage }) => [source, storage])).toEqual(
      [
        "proxy-structured",
        "dns-flow-trace",
        "internal-fqdn-failure",
        "network-rule",
        "application-rule",
        "flow-trace",
        "nat-rule",
      ].flatMap((source) => [
        [source, "resource-specific"],
        [source, "azure-diagnostics"],
      ]),
    );
    expect(result.readiness.every(({ status }) => status === "success")).toBe(true);
    expect(result.readiness.map(({ sampleCount }) => sampleCount)).toEqual(sampleCounts);
    expect(fetchImplementation).toHaveBeenCalledTimes(14);
    expect(
      fetchImplementation.mock.calls.every(([, init]) => {
        if (typeof init?.body !== "string") return false;
        return !("timespan" in (JSON.parse(init.body) as object));
      }),
    ).toBe(true);
  });

  it("reports missing tables separately from empty AzureDiagnostics categories", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      return query.includes("\nAZFWDnsFlowTrace\n")
        ? readinessResponse(0, false)
        : readinessResponse(0);
    });

    const result = await executeDnsReadinessQuery({ workspaceId }, "access-token", {
      fetchImplementation,
    });

    expect(result.readiness.filter(({ source }) => source === "dns-flow-trace")).toEqual([
      {
        source: "dns-flow-trace",
        storage: "resource-specific",
        status: "missing",
        sampleCount: null,
      },
      {
        source: "dns-flow-trace",
        storage: "azure-diagnostics",
        status: "success",
        sampleCount: 0,
      },
    ]);
  });

  it("reports authorization and query failures for each storage check", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.includes("\nAZFWDnsQuery\n")) return new Response(null, { status: 403 });
      if (query.includes("\nAZFWNetworkRule\n")) return new Response(null, { status: 500 });
      return readinessResponse();
    });

    const result = await executeDnsReadinessQuery({ workspaceId }, "access-token", {
      fetchImplementation,
    });

    expect(result.readiness).toContainEqual({
      source: "proxy-structured",
      storage: "resource-specific",
      status: "forbidden",
      sampleCount: null,
    });
    expect(result.readiness).toContainEqual({
      source: "network-rule",
      storage: "resource-specific",
      status: "failed",
      sampleCount: null,
    });
    expect(result.readiness).toContainEqual({
      source: "network-rule",
      storage: "azure-diagnostics",
      status: "success",
      sampleCount: 2,
    });
  });

  it("does not hide an AzureDiagnostics failure behind an empty dedicated table", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.includes("\nAzureDiagnostics\n")) return new Response(null, { status: 500 });
      return readinessResponse(0);
    });

    const result = await executeDnsReadinessQuery({ workspaceId }, "access-token", {
      fetchImplementation,
    });

    expect(result.readiness.filter(({ source }) => source === "network-rule")).toEqual([
      {
        source: "network-rule",
        storage: "resource-specific",
        status: "success",
        sampleCount: 0,
      },
      {
        source: "network-rule",
        storage: "azure-diagnostics",
        status: "failed",
        sampleCount: null,
      },
    ]);
  });

  it("keeps successful DNS entries when a network store is forbidden", async () => {
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
      if (query.startsWith("AZFWNetworkRule")) return new Response(null, { status: 403 });
      return response(azureResponse(["TimeGenerated"], []));
    });

    const result = await executeDnsListQuery({ workspaceId }, createListRequest(), "access-token", {
      fetchImplementation,
    });

    expect(result.queriedEntries).toHaveLength(1);
    expect(result.sources).toContainEqual({
      source: "network-rule",
      availability: "forbidden",
      truncated: false,
      warning: "Source query forbidden",
    });
  });

  it.each([
    ["malformed", () => response({ tables: [{}] }), "failed"],
    ["forbidden", () => new Response(null, { status: 403 }), "forbidden"],
    ["failed", () => new Response(null, { status: 500 }), "failed"],
  ])("reports selected AzureDiagnostics source as %s", async (_name, azure, availability) => {
    const request = createListRequest();
    request.filters.source = "network-rule";
    request.storage = "azure-diagnostics";
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      return query.startsWith("AzureDiagnostics")
        ? azure()
        : response(azureResponse(["TimeGenerated"], []));
    });

    const result = await executeDnsListQuery({ workspaceId }, request, "access-token", {
      fetchImplementation,
    });

    expect(result.sources).toEqual([
      {
        source: "network-rule",
        availability,
        truncated: false,
        warning: availability === "forbidden" ? "Source query forbidden" : "Source query failed",
      },
    ]);
  });

  it("queries only the selected resource-specific network source", async () => {
    const request = createListRequest();
    request.filters.source = "network-rule";
    const columns = [
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
    const row = [
      "2026-07-10T10:01:00.000Z",
      "AZFWNetworkRule",
      resourceId,
      "Allow",
      "UDP",
      "10.0.0.4",
      "52338",
      "10.0.0.53",
      "53",
    ];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      expect(query.startsWith("AZFWNetworkRule")).toBe(true);
      expect(query).not.toContain("AzureDiagnostics");
      return response(azureResponse(columns, [row]));
    });

    const result = await executeDnsListQuery({ workspaceId }, request, "access-token", {
      fetchImplementation,
    });

    expect(result.sources).toEqual([
      { source: "network-rule", availability: "available", truncated: false },
    ]);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(result.transportObservations).toHaveLength(1);
  });

  it("reports authorization failure from the selected AzureDiagnostics source", async () => {
    const request = createListRequest();
    request.filters.source = "network-rule";
    request.storage = "azure-diagnostics";
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      expect(query.startsWith("AzureDiagnostics")).toBe(true);
      return new Response(null, { status: 403 });
    });

    const result = await executeDnsListQuery({ workspaceId }, request, "access-token", {
      fetchImplementation,
    });

    expect(result.sources).toEqual([
      {
        source: "network-rule",
        availability: "forbidden",
        truncated: false,
        warning: "Source query forbidden",
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("keeps AzureDiagnostics network rows storage-aware", async () => {
    const request = createListRequest();
    request.filters.source = "network-rule";
    request.storage = "azure-diagnostics";
    const columns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "Action",
      "ActionReason",
      "Protocol",
      "SourceIp",
      "SourcePort",
      "DestinationIp",
      "DestinationPort",
      "Policy",
      "RuleCollectionGroup",
      "RuleCollection",
      "Rule",
    ];
    const row = [
      "2026-07-10T10:01:00.000Z",
      "AZFWNetworkRule",
      resourceId,
      "Allow",
      "",
      "UDP",
      "10.0.0.4",
      "52338",
      "10.0.0.53",
      "53",
      "policy",
      "group",
      "collection",
      "rule",
    ];
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => response(azureResponse(columns, [row])));

    const result = await executeDnsListQuery({ workspaceId }, request, "access-token", {
      fetchImplementation,
    });

    expect(result.transportObservations).toHaveLength(1);
    expect(result.transportObservations[0]).toMatchObject({
      logAnalyticsStorage: "azure-diagnostics",
    });
    expect(result.transportObservations[0]?.id).toContain("network-rule:azure-diagnostics");
  });

  it("queries only the selected AzureDiagnostics network source", async () => {
    const request = createListRequest();
    request.filters.source = "network-rule";
    request.storage = "azure-diagnostics";
    const columns = [
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
    const row = (timestamp: string) => [
      timestamp,
      "AZFWNetworkRule",
      resourceId,
      "Allow",
      "UDP",
      "10.0.0.4",
      "52338",
      "10.0.0.53",
      "53",
    ];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      expect(query.startsWith("AzureDiagnostics")).toBe(true);
      const timestamp = "2026-07-10T10:02:00.000Z";
      return response(azureResponse(columns, [row(timestamp)]));
    });

    const result = await executeDnsListQuery({ workspaceId }, request, "access-token", {
      fetchImplementation,
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      result.transportObservations.map(({ logAnalyticsStorage }) => logAnalyticsStorage),
    ).toEqual(["azure-diagnostics"]);
  });

  it("retains successful zero-row sources across malformed failure envelopes", async () => {
    const failureResponses = [
      new Response(null, { status: 200, headers: { "content-type": "application/json" } }),
      response({}),
      response({ error: { message: "query failed" } }),
      response({ tables: [{}] }),
    ];

    for (const failedResponse of failureResponses) {
      const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
        if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
        const query = String(JSON.parse(init.body).query);
        return query.startsWith("AZFWDnsQuery")
          ? failedResponse.clone()
          : response(azureResponse(["TimeGenerated"], []));
      });

      const result = await executeDnsListQuery(
        { workspaceId },
        createListRequest(),
        "access-token",
        { fetchImplementation },
      );

      expect(result.sources).toEqual([
        {
          source: "proxy-structured",
          availability: "failed",
          truncated: false,
          warning: "Source query failed",
        },
        { source: "dns-flow-trace", availability: "available", truncated: false },
        { source: "internal-fqdn-failure", availability: "available", truncated: false },
        { source: "network-rule", availability: "available", truncated: false },
      ]);
      expect(result.queriedEntries).toEqual([]);
      expect(result.transportObservations).toEqual([]);
    }
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
    expect(detailFetch).toHaveBeenCalledTimes(2);
  });

  it("keeps successful Application Rule evidence separate from primary DNS observations", async () => {
    const primaryColumns = [
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
    const applicationColumns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "Action",
      "ActionReason",
      "Protocol",
      "SourceIp",
      "SourcePort",
      "DestinationPort",
      "Fqdn",
      "TargetUrl",
      "Policy",
      "RuleCollectionGroup",
      "RuleCollection",
      "Rule",
    ];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.startsWith("AZFWDnsQuery")) {
        return response(
          azureResponse(primaryColumns, [
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
      if (query.startsWith("AZFWApplicationRule")) {
        return response(
          azureResponse(applicationColumns, [
            [
              "2026-07-10T10:01:01.000Z",
              "AZFWApplicationRule",
              resourceId,
              "Allow",
              "Matched rule",
              "HTTPS",
              "10.0.0.4",
              "52339",
              "443",
              "example.com",
              "https://example.com/",
              "hub-policy",
              "hub-group",
              "application-rules",
              "allow-example",
            ],
          ]),
        );
      }
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await executeDnsDetailQuery(
      { workspaceId },
      createDetailRequest(),
      "access-token",
      { fetchImplementation },
    );

    expect(result.observations).toHaveLength(1);
    expect(result.observations[0]).toMatchObject({
      source: "proxy-structured",
      queryName: "example.com.",
    });
    expect(result.relatedEvidence).toEqual([
      expect.objectContaining({
        source: "application-rule",
        action: "Allow",
        actionReason: "Matched rule",
        queryName: "example.com",
        targetUrl: "https://example.com/",
        rule: "allow-example",
      }),
    ]);
    expect(result.relatedSources).toEqual([
      { source: "application-rule", availability: "available", truncated: false },
      { source: "flow-trace", availability: "not-applicable", truncated: false },
      { source: "nat-rule", availability: "not-applicable", truncated: false },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("preserves primary network detail when related Flow and NAT queries fail", async () => {
    const selector = {
      source: "network-rule" as const,
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      logAnalyticsStorage: "resource-specific" as const,
      protocol: "TCP",
      networkSourceIp: "10.0.0.4",
      networkSourcePort: "52338",
      networkDestinationIp: "168.63.129.16",
      networkDestinationPort: "53",
    };
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
      "Policy",
      "RuleCollectionGroup",
      "RuleCollection",
      "Rule",
    ];
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      if (query.startsWith("AZFWNetworkRule")) {
        return response(
          azureResponse(networkColumns, [
            [
              selector.timestamp,
              "AZFWNetworkRule",
              resourceId,
              "Allow",
              "TCP",
              selector.networkSourceIp,
              selector.networkSourcePort,
              selector.networkDestinationIp,
              selector.networkDestinationPort,
              "hub-policy",
              "hub-group",
              "network-rules",
              "allow-dns",
            ],
          ]),
        );
      }
      if (query.startsWith("AZFWFlowTrace")) return new Response(null, { status: 403 });
      if (query.startsWith("AZFWNatRule")) return new Response(null, { status: 500 });
      throw new Error(`Unexpected query: ${query}`);
    });

    const result = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation,
    });

    expect(result.observations).toEqual([
      expect.objectContaining({
        source: "network-rule",
        clientIp: "10.0.0.4",
        serverIp: "168.63.129.16",
        outcome: "transport-observed",
      }),
    ]);
    expect(result.relatedEvidence).toEqual([]);
    expect(result.relatedSources).toEqual([
      { source: "application-rule", availability: "not-applicable", truncated: false },
      {
        source: "flow-trace",
        availability: "forbidden",
        truncated: false,
        warning: "Related source query forbidden",
      },
      {
        source: "nat-rule",
        availability: "failed",
        truncated: false,
        warning: "Related source query failed",
      },
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("bounds related Application Rule evidence at 50 rows and reports truncation", async () => {
    const primaryColumns = [
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
    const applicationColumns = [
      "TimeGenerated",
      "Category",
      "ResourceId",
      "Action",
      "SourceIp",
      "SourcePort",
      "DestinationPort",
      "Fqdn",
    ];
    const applicationRows = Array.from({ length: 51 }, (_, index) => [
      new Date(Date.parse("2026-07-10T10:01:00.000Z") + index).toISOString(),
      "AZFWApplicationRule",
      resourceId,
      "Allow",
      "10.0.0.4",
      String(52_000 + index),
      "443",
      "example.com",
    ]);
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
      const query = String(JSON.parse(init.body).query);
      return response(
        query.startsWith("AZFWDnsQuery")
          ? azureResponse(primaryColumns, [
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
            ])
          : azureResponse(applicationColumns, applicationRows),
      );
    });

    const result = await executeDnsDetailQuery(
      { workspaceId },
      createDetailRequest(),
      "access-token",
      { fetchImplementation },
    );

    expect(result.observations).toHaveLength(1);
    expect(result.relatedEvidence).toHaveLength(50);
    expect(result.relatedEvidence?.every((item) => item.source === "application-rule")).toBe(true);
    expect(result.relatedSources).toContainEqual({
      source: "application-rule",
      availability: "available",
      truncated: true,
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
