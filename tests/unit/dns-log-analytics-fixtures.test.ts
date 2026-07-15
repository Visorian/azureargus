import type { DnsListQueryRequest } from "../../shared/types/dns";
import {
  executeDnsDetailQuery,
  executeDnsListQuery,
} from "../../server/utils/dnsLogAnalyticsQuery";
import { createDnsDetailSelector } from "../../shared/utils/dns";
import structuredFixture from "../fixtures/dns/log-analytics-azfwdnsquery.sanitized.json";
import azureDiagnosticsNetworkFixture from "../fixtures/dns/log-analytics-azurediagnostics-azfwnetworkrule.sanitized.json";
import networkFixture from "../fixtures/dns/log-analytics-azfwnetworkrule.sanitized.json";

const workspaceId = "33333333-3333-4333-8333-333333333333";
const STRUCTURED_QUERY_PATTERN = /^AZFWDnsQuery\n/;
const NETWORK_QUERY_PATTERN = /^AZFWNetworkRule\n/;
const AZURE_DIAGNOSTICS_QUERY_PATTERN = /^AzureDiagnostics\n/;

function normalizedAzureDiagnosticsNetworkFixture() {
  const table = azureDiagnosticsNetworkFixture.tables[0]!;
  return {
    tables: [
      {
        name: table.name,
        columns: [
          { name: "TimeGenerated", type: "datetime" },
          { name: "Category", type: "string" },
          { name: "ResourceId", type: "string" },
          { name: "Action", type: "string" },
          { name: "ActionReason", type: "string" },
          { name: "Protocol", type: "string" },
          { name: "SourceIp", type: "string" },
          { name: "SourcePort", type: "string" },
          { name: "DestinationIp", type: "string" },
          { name: "DestinationPort", type: "string" },
          { name: "Policy", type: "string" },
          { name: "RuleCollectionGroup", type: "string" },
          { name: "RuleCollection", type: "string" },
          { name: "Rule", type: "string" },
        ],
        rows: table.rows.map((row) => [
          row[0],
          "AZFWNetworkRule",
          row[1],
          row[2],
          row[3] ?? "",
          row[4],
          row[5],
          String(row[6]),
          row[7],
          String(row[8]),
          row[9],
          row[10],
          row[11],
          row[12],
        ]),
      },
    ],
  };
}

function readQuery(init?: RequestInit) {
  if (typeof init?.body !== "string") throw new Error("Expected JSON request body");
  const value: unknown = JSON.parse(init.body);
  if (typeof value !== "object" || value === null || !("query" in value)) {
    throw new Error("Expected query request");
  }
  if (typeof value.query !== "string") throw new Error("Expected query text");
  return value.query;
}

function requestFor(
  source: "proxy-structured" | "network-rule",
  storage: DnsListQueryRequest["storage"] = "resource-specific",
): DnsListQueryRequest {
  return {
    from: "2026-01-15T09:59:00.000Z",
    to: "2026-01-15T10:01:00.000Z",
    filters: {
      search: "",
      queryType: "",
      client: "",
      protocol: "",
      outcome: "",
      source,
    },
    limit: 100,
    storage,
  };
}

function response(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("sanitized DNS Log Analytics fixtures", () => {
  it("maps captured AZFWDnsQuery shapes into conservative named observations", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      expect(readQuery(init)).toMatch(STRUCTURED_QUERY_PATTERN);
      return response(structuredFixture);
    });

    const result = await executeDnsListQuery(
      { workspaceId },
      requestFor("proxy-structured"),
      "access-token",
      { fetchImplementation, queryId: "fixture-list" },
    );

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(result.sources).toEqual([
      { source: "proxy-structured", availability: "available", truncated: false },
    ]);
    expect(result.transportObservations).toEqual([]);
    expect(result.queriedEntries).toHaveLength(6);
    expect(result.queriedEntries.map((entry) => entry.outcome)).toEqual(
      expect.arrayContaining([
        "response-unknown",
        "response-unknown",
        "response-unknown",
        "dns-error",
        "dns-error",
        "transport-error",
      ]),
    );

    const success = result.queriedEntries.find(
      (entry) => entry.queryName === "query-1.fixture.example.",
    );
    expect(success).toMatchObject({
      queryType: "A",
      client: "192.0.2.10:54286",
      protocol: "UDP",
      outcome: "response-unknown",
      observationCount: 1,
      confidence: "uncorrelated",
      detailSelector: {
        source: "proxy-structured",
        queryId: "1201",
        queryName: "query-1.fixture.example.",
        clientIp: "192.0.2.10",
        clientPort: "54286",
      },
    });
  });

  it("resolves captured structured detail without associating neighboring rows", async () => {
    const list = await executeDnsListQuery(
      { workspaceId },
      requestFor("proxy-structured"),
      "access-token",
      {
        fetchImplementation: async () => response(structuredFixture),
        queryId: "fixture-list",
      },
    );
    const selected = list.queriedEntries.find(
      (entry) => entry.queryName === "query-1.fixture.example.",
    );
    expect(selected?.detailSelector).toBeDefined();

    const detail = await executeDnsDetailQuery(
      { workspaceId },
      { selector: selected!.detailSelector! },
      "access-token",
      {
        fetchImplementation: async () => response(structuredFixture),
        queryId: "fixture-detail",
      },
    );

    expect(detail).toMatchObject({
      completeness: "complete",
      detailTruncated: false,
      warnings: [],
      observations: [
        {
          source: "proxy-structured",
          stage: "proxy-exchange",
          queryName: "query-1.fixture.example.",
          responseCode: "NOERROR",
          responseFlags: ["qr", "rd", "ra"],
          requestSizeBytes: 47,
          responseSizeBytes: 453,
          durationSeconds: 0.005811781,
        },
      ],
    });
    expect(detail.observations[0]).not.toHaveProperty("logAnalyticsStorage");
  });

  it("keeps captured AZFWNetworkRule rows as unidentified transport evidence", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const query = readQuery(init);
      expect(query).toMatch(NETWORK_QUERY_PATTERN);
      return response(networkFixture);
    });

    const result = await executeDnsListQuery(
      { workspaceId },
      requestFor("network-rule"),
      "access-token",
      { fetchImplementation, queryId: "fixture-network" },
    );

    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(result.queriedEntries).toEqual([]);
    expect(result.transportObservations).toHaveLength(8);
    expect(result.transportObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: "blocked" }),
        expect.objectContaining({ outcome: "transport-observed" }),
      ]),
    );
    expect(
      result.transportObservations.every(
        (observation) =>
          observation.source === "network-rule" &&
          observation.stage === "transport" &&
          (observation.protocol === "UDP" || observation.protocol === "TCP") &&
          (observation.warnings.includes("DNS transport direction is ambiguous")
            ? observation.serverPort === undefined
            : observation.serverPort === "53") &&
          observation.queryName === undefined,
      ),
    ).toBe(true);
    expect(
      result.transportObservations.filter(({ outcome }) => outcome === "blocked"),
    ).toHaveLength(2);
    expect(
      result.transportObservations.filter(({ outcome }) => outcome === "transport-observed"),
    ).toHaveLength(6);
  });

  it("maps captured AzureDiagnostics network rows as storage-aware DNS transport", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const query = readQuery(init);
      if (AZURE_DIAGNOSTICS_QUERY_PATTERN.test(query)) {
        return response(normalizedAzureDiagnosticsNetworkFixture());
      }
      return response({
        tables: [{ name: "PrimaryResult", columns: [], rows: [] }],
      });
    });

    const result = await executeDnsListQuery(
      { workspaceId },
      requestFor("network-rule", "azure-diagnostics"),
      "access-token",
      { fetchImplementation, queryId: "fixture-azure-diagnostics-network" },
    );

    expect(result.queriedEntries).toEqual([]);
    expect(fetchImplementation).toHaveBeenCalledOnce();
    expect(
      fetchImplementation.mock.calls
        .map(([, init]) => readQuery(init))
        .some((query) => query.includes('column_ifexists("DestinationPort_d", real(null))')),
    ).toBe(true);
    expect(result.transportObservations).toHaveLength(4);
    expect(result.transportObservations.every((row) => row.serverPort === "53")).toBe(true);
    expect(result.transportObservations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logAnalyticsStorage: "azure-diagnostics",
          protocol: "TCP",
          source: "network-rule",
        }),
      ]),
    );
    expect(new Set(result.transportObservations.map((row) => row.id)).size).toBe(4);
    expect(
      result.transportObservations.every((row) =>
        row.id.startsWith("la:network-rule:azure-diagnostics:"),
      ),
    ).toBe(true);

    const tcp = result.transportObservations.find((row) => row.protocol === "TCP");
    const selector = tcp && createDnsDetailSelector(tcp);
    expect(selector).toMatchObject({
      source: "network-rule",
      logAnalyticsStorage: "azure-diagnostics",
    });
    if (!selector) throw new Error("Expected Azure Diagnostics detail selector");

    const detail = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation,
      queryId: "fixture-azure-diagnostics-detail",
    });

    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(detail.observations).toEqual([
      expect.objectContaining({
        logAnalyticsStorage: "azure-diagnostics",
        protocol: "TCP",
        source: "network-rule",
      }),
    ]);

    const duplicate = result.transportObservations.find(
      (row) => row.networkSourceIp === "192.0.2.12",
    );
    const duplicateSelector = duplicate && createDnsDetailSelector(duplicate);
    if (!duplicateSelector) throw new Error("Expected duplicate Azure Diagnostics selector");

    const ambiguous = await executeDnsDetailQuery(
      { workspaceId },
      { selector: duplicateSelector },
      "access-token",
      { fetchImplementation, queryId: "fixture-azure-diagnostics-duplicate-detail" },
    );

    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    expect(ambiguous).toMatchObject({
      observations: [],
      completeness: "partial",
      warnings: ["Selected DNS entry is ambiguous"],
    });
  });

  it("keeps deterministic fixture identities when Log Analytics reorders rows", async () => {
    const reversedFixture = {
      tables: structuredFixture.tables.map((table) => ({
        ...table,
        rows: table.rows.toReversed(),
      })),
    };
    const initial = await executeDnsListQuery(
      { workspaceId },
      requestFor("proxy-structured"),
      "access-token",
      { fetchImplementation: async () => response(structuredFixture) },
    );
    const reordered = await executeDnsListQuery(
      { workspaceId },
      requestFor("proxy-structured"),
      "access-token",
      { fetchImplementation: async () => response(reversedFixture) },
    );
    const idsByName = (entries: typeof initial.queriedEntries) =>
      Object.fromEntries(entries.map(({ id, queryName }) => [queryName, id]));

    expect(idsByName(reordered.queriedEntries)).toEqual(idsByName(initial.queriedEntries));
  });

  it("normalizes transport direction while preserving raw endpoints and rule metadata", async () => {
    const result = await executeDnsListQuery(
      { workspaceId },
      requestFor("network-rule"),
      "access-token",
      { fetchImplementation: async () => response(networkFixture) },
    );
    const responseDirection = result.transportObservations.find(
      ({ networkSourcePort, protocol }) => networkSourcePort === "53" && protocol === "TCP",
    );
    const requestDirection = result.transportObservations.find(
      ({ networkSourcePort }) => networkSourcePort === "53000",
    );
    const ambiguous = result.transportObservations.find(
      ({ networkSourcePort, networkDestinationPort }) =>
        networkSourcePort === "53" && networkDestinationPort === "53",
    );

    expect(responseDirection).toMatchObject({
      clientIp: "192.0.2.21",
      clientPort: "49152",
      serverIp: "192.0.2.53",
      serverPort: "53",
      networkSourceIp: "192.0.2.53",
      networkSourcePort: "53",
      networkDestinationIp: "192.0.2.21",
      networkDestinationPort: "49152",
      policy: "policy-3",
      ruleCollectionGroup: "group-3",
      ruleCollection: "collection-4",
      rule: "rule-5",
      raw: {
        SourceIp: "192.0.2.53",
        SourcePort: 53,
        DestinationIp: "192.0.2.21",
        DestinationPort: 49152,
      },
    });
    expect(requestDirection).toMatchObject({
      clientIp: "192.0.2.22",
      clientPort: "53000",
      serverIp: "192.0.2.53",
      serverPort: "53",
    });
    expect(ambiguous).toMatchObject({
      clientIp: undefined,
      clientPort: undefined,
      serverIp: undefined,
      serverPort: undefined,
      warnings: expect.arrayContaining(["DNS transport direction is ambiguous"]),
    });
  });

  it("requeries network detail with raw direction fields and retains metadata", async () => {
    const list = await executeDnsListQuery(
      { workspaceId },
      requestFor("network-rule"),
      "access-token",
      { fetchImplementation: async () => response(networkFixture) },
    );
    const selected = list.transportObservations.find(
      ({ networkSourcePort, protocol }) => networkSourcePort === "53" && protocol === "TCP",
    );
    expect(selected).toBeDefined();
    const selector = {
      source: selected!.source,
      resourceId: selected!.resourceId!,
      timestamp: selected!.timestamp,
      protocol: selected!.protocol!,
      networkSourceIp: selected!.networkSourceIp!,
      networkSourcePort: selected!.networkSourcePort!,
      networkDestinationIp: selected!.networkDestinationIp!,
      networkDestinationPort: selected!.networkDestinationPort!,
    } as const;

    const detail = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation: async () => response(networkFixture),
    });

    expect(detail).toMatchObject({
      completeness: "partial",
      detailTruncated: false,
      warnings: [],
      observations: [
        {
          clientIp: "192.0.2.21",
          serverIp: "192.0.2.53",
          policy: "policy-3",
          ruleCollectionGroup: "group-3",
          ruleCollection: "collection-4",
          rule: "rule-5",
        },
      ],
    });
  });

  it("reports missing and ambiguous fixture detail without guessing", async () => {
    const table = structuredFixture.tables[0]!;
    const selectedRow = table.rows[0]!;
    const selector = {
      source: "proxy-structured" as const,
      resourceId: String(selectedRow[2]),
      timestamp: String(selectedRow[0]),
      queryId: String(selectedRow[5]),
      queryName: String(selectedRow[8]),
      clientIp: String(selectedRow[3]),
      clientPort: String(selectedRow[4]),
    };
    const missingPayload = { tables: [{ ...table, rows: [] }] };
    const ambiguousPayload = { tables: [{ ...table, rows: [selectedRow, [...selectedRow]] }] };

    const missing = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation: async () => response(missingPayload),
    });
    const ambiguous = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation: async () => response(ambiguousPayload),
    });

    expect(missing).toEqual({
      observations: [],
      detailTruncated: false,
      completeness: "partial",
      warnings: ["Selected DNS entry is no longer available"],
    });
    expect(ambiguous).toEqual({
      observations: [],
      detailTruncated: false,
      completeness: "partial",
      warnings: ["Selected DNS entry is ambiguous"],
    });
  });

  it("reports detail truncation independently from exact selector matching", async () => {
    const table = structuredFixture.tables[0]!;
    const selectedRow = table.rows[0]!;
    const otherRows = Array.from({ length: 200 }, (_, index) => {
      const row = [...table.rows[1]!];
      row[0] = new Date(Date.parse(String(row[0])) + index + 1).toISOString();
      return row;
    });
    const payload = { tables: [{ ...table, rows: [selectedRow, ...otherRows] }] };
    const selector = {
      source: "proxy-structured" as const,
      resourceId: String(selectedRow[2]),
      timestamp: String(selectedRow[0]),
      queryId: String(selectedRow[5]),
      queryName: String(selectedRow[8]),
      clientIp: String(selectedRow[3]),
      clientPort: String(selectedRow[4]),
    };

    const detail = await executeDnsDetailQuery({ workspaceId }, { selector }, "access-token", {
      fetchImplementation: async () => response(payload),
    });

    expect(detail).toMatchObject({
      observations: [expect.objectContaining({ queryName: "query-1.fixture.example." })],
      detailTruncated: true,
      completeness: "range-truncated",
    });
  });
});
