import type { LogAnalyticsQueryRequest } from "../../shared/types/logAnalytics";
import type { LogAnalyticsRuntimeConfig } from "../../server/utils/logAnalyticsAuth";
import {
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
    sort: { key: "timestamp", direction: "desc" },
  };
}

function createAzureResponse(rows: unknown[][]) {
  return {
    tables: [{ name: "PrimaryResult", columns, rows }],
  };
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
    expect(result.query).toContain('ActionReason =~ "Default Action"');
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
  it("uses the configured workspace endpoint and explicit timespan", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(createAzureResponse([])), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await executeLogAnalyticsQuery(config, createRequest(), "access-token", {
      fetchImplementation,
      queryId: "query-id",
    });

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(
      `https://api.loganalytics.azure.com/v1/workspaces/${config.workspaceId}/query`,
    );
    expect(init?.headers).toEqual({
      authorization: "Bearer access-token",
      "content-type": "application/json",
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      timespan: "2026-07-10T10:00:00.000Z/2026-07-10T10:15:00.000Z",
    });
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
