import type { LogAnalyticsQueryRequest } from "../../shared/types/logAnalytics";
import type { LogAnalyticsRuntimeConfig } from "../../server/utils/logAnalyticsAuth";
import {
  buildAzureDiagnosticsLogAnalyticsQuery,
  buildLogAnalyticsQuery,
  encodeKqlStringLiteral,
  executeLogAnalyticsQuery,
  LogAnalyticsQueryError,
  mapLogAnalyticsResponse,
} from "../../server/utils/logAnalyticsQuery";

const config: LogAnalyticsRuntimeConfig = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "secret",
  workspaceId: "33333333-3333-3333-3333-333333333333",
};

const columns = [
  "TimeGenerated",
  "Category",
  "Action",
  "Protocol",
  "SourceIp",
  "SourcePort",
  "DestinationIp",
  "DestinationFqdn",
  "DestinationPort",
  "Policy",
  "RuleCollectionGroup",
  "RuleCollection",
  "Rule",
  "Message",
].map((name) => ({ name, type: "string" }));

function createRequest(): LogAnalyticsQueryRequest {
  return {
    from: "2026-07-10T10:00:00.000Z",
    to: "2026-07-10T10:15:00.000Z",
    filters: {
      search: "",
      category: "",
      action: "",
      protocol: "",
      source: "",
      destination: "",
    },
    limit: 1_000,
    storage: "resource-specific",
    sort: { key: "timestamp", direction: "desc" },
  };
}

function createAzureResponse(rows: unknown[][]) {
  return {
    tables: [{ name: "PrimaryResult", columns, rows }],
  };
}

function createNetworkRow(timestamp: string, message: string, protocol = "UDP"): unknown[] {
  return [
    timestamp,
    "AZFWNetworkRule",
    "Allow",
    protocol,
    "10.0.0.5",
    "51001",
    "10.0.0.53",
    "",
    "53",
    "policy",
    "group",
    "collection",
    "dns",
    message,
  ];
}

function response(rows: unknown[][], status = 200) {
  return new Response(JSON.stringify(createAzureResponse(rows)), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestQuery(init?: RequestInit) {
  if (typeof init?.body !== "string") throw new Error("Expected request body");
  const body: unknown = JSON.parse(init.body);
  if (typeof body !== "object" || body === null || !("query" in body)) {
    throw new Error("Expected query body");
  }
  const query = body.query;
  if (typeof query !== "string") throw new Error("Expected query string");
  return query;
}

describe("Log Analytics KQL builder", () => {
  it("uses fixed tables and the initial cap for the default query", () => {
    const result = buildLogAnalyticsQuery(createRequest());

    expect(result.limit).toBe(1_000);
    expect(result.query).toContain(
      "union isfuzzy=true withsource=Category AZFWNetworkRule, AZFWApplicationRule, AZFWNatRule",
    );
    expect(result.query).toContain('Policy = tostring(column_ifexists("Policy", ""))');
    expect(result.query).toContain(
      'RuleCollectionGroup = tostring(column_ifexists("RuleCollectionGroup", ""))',
    );
    expect(result.query).toContain('isempty(Rule) and ActionReason contains "default action"');
    expect(result.query).toContain("| order by TimeGenerated desc");
    expect(result.query).toContain("| take 1001");
  });

  it("matches trimmed case-insensitive browser filters and preserves requested cap", () => {
    const request = createRequest();
    request.filters.search = "  Firewall  ";
    request.filters.category = "AZFWNetworkRule";
    request.filters.action = "  DeNy  ";
    request.filters.protocol = "Tcp";
    request.filters.source = "10.0.0.4:443";
    request.filters.destination = "Example.COM:443";
    request.sort = { key: "rule", direction: "asc" };
    request.limit = 5_000;

    const result = buildLogAnalyticsQuery(request);

    expect(result.limit).toBe(5_000);
    expect(result.query).toContain('| where SearchableText contains "firewall"');
    expect(result.query).toContain('| where Category contains "azfwnetworkrule"');
    expect(result.query).toContain('| where Action contains "deny"');
    expect(result.query).toContain('| where Protocol contains "tcp"');
    expect(result.query).toContain(
      '| where strcat(SourceIp, ":", SourcePort) contains "10.0.0.4:443"',
    );
    expect(result.query).toContain(
      '| where strcat(DestinationIp, ":", DestinationPort) contains "example.com:443"',
    );
    expect(result.query).toContain("| order by tolower(Rule) asc");
    expect(result.query).toContain("| take 5001");
  });

  it("encodes filter values as one KQL string literal", () => {
    const hostileValue = 'x" | take 9999\nback\\slash';
    const request = createRequest();
    request.filters.search = hostileValue;

    expect(encodeKqlStringLiteral(hostileValue)).toBe(JSON.stringify(hostileValue));
    const { query } = buildLogAnalyticsQuery(request);
    expect(query).toContain(JSON.stringify(hostileValue.toLowerCase()));
    expect(query).not.toContain("\n| take 9999\n");
  });

  it("normalizes only captured AzureDiagnostics network-rule fields", () => {
    const request = createRequest();
    request.filters.search = "dns-rule";
    request.filters.category = "AZFWNetworkRule";
    request.filters.action = "Allow";
    request.filters.protocol = "UDP";
    request.filters.source = "10.0.0.5:51001";
    request.filters.destination = "10.0.0.53:53";

    const result = buildAzureDiagnosticsLogAnalyticsQuery(request);

    expect(result.limit).toBe(1_000);
    expect(result.query).toContain("AzureDiagnostics");
    expect(result.query).toContain('| where ResourceProvider =~ "MICROSOFT.NETWORK"');
    expect(result.query).toContain('| where ResourceType =~ "AZUREFIREWALLS"');
    expect(result.query).toContain('| where Category == "AZFWNetworkRule"');
    expect(result.query).toContain('SourceIp = tostring(column_ifexists("SourceIP", ""))');
    expect(result.query).toContain(
      'SourcePort = tostring(column_ifexists("SourcePort_d", real(null)))',
    );
    expect(result.query).toContain(
      'DestinationIp = tostring(column_ifexists("DestinationIp_s", ""))',
    );
    expect(result.query).toContain(
      'DestinationPort = tostring(column_ifexists("DestinationPort_d", real(null)))',
    );
    expect(result.query).toContain(
      'RuleCollectionGroup = tostring(column_ifexists("RuleCollectionGroup_s", ""))',
    );
    expect(result.query).toContain('| where Protocol contains "udp"');
    expect(result.query).toContain('| where SearchableText contains "dns-rule"');
    expect(result.query).toContain('| where Category contains "azfwnetworkrule"');
    expect(result.query).toContain('| where Action contains "allow"');
    expect(result.query).toContain(
      '| where strcat(SourceIp, ":", SourcePort) contains "10.0.0.5:51001"',
    );
    expect(result.query).toContain(
      '| where strcat(DestinationIp, ":", DestinationPort) contains "10.0.0.53:53"',
    );
    expect(result.query).toContain("| take 1001");
    expect(result.query).not.toContain("AzureFirewallNetworkRule");
    expect(result.query).not.toContain("AZFWNetworkRuleAggregation");
  });
});

describe("Log Analytics response mapping", () => {
  it("maps canonical rows, sorts them, and reports truncation", () => {
    const response = createAzureResponse([
      [
        "2026-07-10T10:00:00Z",
        "AZFWNetworkRule",
        "Deny",
        "TCP",
        "10.0.0.4",
        "51000",
        "20.30.40.50",
        "",
        "443",
        "hub-policy",
        "hub-collection-group",
        "blocked",
        "deny-web",
        "Deny TCP",
      ],
      [
        "2026-07-10T10:01:00Z",
        "AZFWApplicationRule",
        "Allow",
        "HTTPS",
        "10.0.0.5",
        "51001",
        "example.com",
        "example.com",
        "443",
        "app-policy",
        "app-collection-group",
        "web",
        "allow-web",
        "Allow HTTPS",
      ],
    ]);

    const result = mapLogAnalyticsResponse(
      response,
      { key: "timestamp", direction: "desc" },
      "query-id",
      1,
    );

    expect(result).toMatchObject({ limit: 1, truncated: true });
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({
      id: "query-id:0:1",
      timestamp: "2026-07-10T10:01:00.000Z",
      category: "AZFWApplicationRule",
      destinationIp: "example.com",
      destinationPort: "443",
      policy: "app-policy",
      ruleCollectionGroup: "app-collection-group",
    });
    expect(result.records[0]?.raw).toEqual({
      TimeGenerated: "2026-07-10T10:01:00.000Z",
      Category: "AZFWApplicationRule",
      Action: "Allow",
      Protocol: "HTTPS",
      SourceIp: "10.0.0.5",
      SourcePort: "51001",
      DestinationIp: "example.com",
      DestinationFqdn: "example.com",
      DestinationPort: "443",
      Policy: "app-policy",
      RuleCollectionGroup: "app-collection-group",
      RuleCollection: "web",
      Rule: "allow-web",
      Message: "Allow HTTPS",
    });
  });

  it("rejects malformed schemas and timestamps", () => {
    expect(() =>
      mapLogAnalyticsResponse(
        createAzureResponse([["invalid-timestamp"]]),
        { key: "timestamp", direction: "desc" },
        "query-id",
        1_000,
      ),
    ).toThrow(LogAnalyticsQueryError);
    expect(() =>
      mapLogAnalyticsResponse(
        { tables: [{ columns: [{ name: "TimeGenerated" }], rows: [] }] },
        { key: "timestamp", direction: "desc" },
        "query-id",
        1_000,
      ),
    ).toThrow(LogAnalyticsQueryError);
    expect(() =>
      mapLogAnalyticsResponse(
        { tables: [{ columns: [], rows: [["2026-07-10T10:00:00Z"]] }] },
        { key: "timestamp", direction: "desc" },
        "query-id",
        1_000,
      ),
    ).toThrow(LogAnalyticsQueryError);
  });

  it("rejects partial Azure results instead of treating them as authoritative", () => {
    expect(() =>
      mapLogAnalyticsResponse(
        {
          ...createAzureResponse([]),
          error: { code: "PartialError", message: "Partial query failure" },
        },
        { key: "timestamp", direction: "desc" },
        "query-id",
        1_000,
      ),
    ).toThrow(LogAnalyticsQueryError);
  });
});

describe("Log Analytics Azure request", () => {
  it("queries only the selected resource-specific store", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([createNetworkRow("2026-07-10T10:00:00Z", "resource-specific")]));

    const result = await executeLogAnalyticsQuery(config, createRequest(), "access-token", {
      fetchImplementation,
      queryId: "query-id",
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    if (typeof init?.body !== "string") throw new Error("Expected request body");
    expect(url).toBe(
      `https://api.loganalytics.azure.com/v1/workspaces/${config.workspaceId}/query`,
    );
    expect(init.headers).toEqual({
      authorization: "Bearer access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(init.body)).toMatchObject({
      timespan: "2026-07-10T10:00:00.000Z/2026-07-10T10:15:00.000Z",
    });
    expect(requestQuery(init)).toContain("AZFWApplicationRule");
    expect(requestQuery(init)).not.toContain("AzureDiagnostics");
    expect(result.records).toEqual([
      expect.objectContaining({ id: "query-id:0:0", message: "resource-specific" }),
    ]);
  });

  it("queries only AzureDiagnostics and preserves its record ID namespace", async () => {
    const request = createRequest();
    request.storage = "azure-diagnostics";
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        response([
          createNetworkRow("2026-07-10T10:01:00Z", "Allow UDP from 10.0.0.5:51001 to 10.0.0.53:53"),
        ]),
      );

    const result = await executeLogAnalyticsQuery(config, request, "access-token", {
      fetchImplementation,
      queryId: "query-id",
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(requestQuery(init)).toContain("AzureDiagnostics");
    expect(requestQuery(init)).not.toContain("union isfuzzy=true withsource=Category");
    expect(result).toMatchObject({ limit: 1_000, truncated: false });
    expect(result.records).toEqual([
      expect.objectContaining({
        category: "AZFWNetworkRule",
        id: "query-id:azure-diagnostics:0:0",
        protocol: "UDP",
      }),
    ]);
  });

  it("does not fall back when the selected store fails", async () => {
    const request = createRequest();
    request.storage = "azure-diagnostics";
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response([], 500));

    await expect(
      executeLogAnalyticsQuery(config, request, "access-token", {
        fetchImplementation,
        queryId: "query-id",
      }),
    ).rejects.toMatchObject({ kind: "upstream" });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("aborts timed-out upstream requests", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });

    const error = await executeLogAnalyticsQuery(config, createRequest(), "access-token", {
      fetchImplementation,
      timeoutMs: 1,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LogAnalyticsQueryError);
    expect(error).toMatchObject({
      kind: "timeout",
      message: "Log Analytics query failed",
    });
  });
});
