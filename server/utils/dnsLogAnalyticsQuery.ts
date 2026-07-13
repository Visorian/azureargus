import type {
  DelegatedDnsDetailQueryRequest,
  DelegatedDnsListQueryRequest,
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsDetailSelector,
  DnsFilters,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsObservation,
  DnsSourceKind,
  DnsSourceStatus,
} from "../../shared/types/dns";
import { createDnsEntries, parseDnsObservation } from "../../shared/utils/dns";
import {
  encodeKqlStringLiteral,
  executeLogAnalyticsRawQuery,
  LogAnalyticsQueryError,
  type ExecuteLogAnalyticsQueryOptions,
  type LogAnalyticsQueryTarget,
} from "./logAnalyticsQuery";

const MAX_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_FILTER_LENGTH = 256;
const LIST_LIMIT = 1_000;
const DETAIL_LIMIT = 200;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const FIREWALL_RESOURCE_ID_PATTERN =
  /^\/subscriptions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/resourceGroups\/[^/]{1,90}\/providers\/Microsoft\.Network\/azureFirewalls\/[^/]{1,260}$/i;
const SOURCE_KINDS = ["proxy-legacy", "proxy-structured", "flow-trace", "network-rule"] as const;
const FILTER_KEYS = ["search", "queryType", "client", "protocol", "outcome", "source"] as const;

interface SourceQuery {
  source: DnsSourceKind;
  query: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]) {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  return Object.keys(value).length === expected.length && hasOnlyKeys(value, expected);
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isFilters(value: unknown): value is DnsFilters {
  return (
    isRecord(value) &&
    hasExactKeys(value, FILTER_KEYS) &&
    FILTER_KEYS.every(
      (key) => typeof value[key] === "string" && value[key].length <= MAX_FILTER_LENGTH,
    )
  );
}

function validRange(from: string, to: string) {
  const fromTime = Date.parse(from);
  const toTime = Date.parse(to);
  return fromTime < toTime && toTime - fromTime <= MAX_RANGE_MS;
}

export function validateDnsListQueryRequest(value: unknown): value is DnsListQueryRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["from", "to", "filters"]) &&
    isIsoTimestamp(value.from) &&
    isIsoTimestamp(value.to) &&
    validRange(value.from, value.to) &&
    isFilters(value.filters)
  );
}

export function validateDelegatedDnsListQueryRequest(
  value: unknown,
): value is DelegatedDnsListQueryRequest {
  if (!isRecord(value) || !hasExactKeys(value, ["workspaceId", "from", "to", "filters"])) {
    return false;
  }
  const { workspaceId, ...request } = value;
  return (
    typeof workspaceId === "string" &&
    WORKSPACE_ID_PATTERN.test(workspaceId) &&
    validateDnsListQueryRequest(request)
  );
}

function isDetailSelector(value: unknown): value is DnsDetailSelector {
  const source = isRecord(value) ? value.source : undefined;
  const optionalKeys =
    source === "flow-trace" || source === "network-rule"
      ? ["clientIp", "clientPort"]
      : ["queryId", "queryName", "clientIp", "clientPort"];
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["source", "resourceId", "timestamp", ...optionalKeys]) ||
    !SOURCE_KINDS.includes(value.source as DnsSourceKind) ||
    typeof value.resourceId !== "string" ||
    !FIREWALL_RESOURCE_ID_PATTERN.test(value.resourceId) ||
    !isIsoTimestamp(value.timestamp)
  ) {
    return false;
  }
  return optionalKeys.every(
    (key) =>
      value[key] === undefined ||
      (typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 256),
  );
}

export function validateDnsDetailQueryRequest(value: unknown): value is DnsDetailQueryRequest {
  return isRecord(value) && hasExactKeys(value, ["selector"]) && isDetailSelector(value.selector);
}

export function validateDelegatedDnsDetailQueryRequest(
  value: unknown,
): value is DelegatedDnsDetailQueryRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["workspaceId", "selector"]) &&
    typeof value.workspaceId === "string" &&
    WORKSPACE_ID_PATTERN.test(value.workspaceId) &&
    isDetailSelector(value.selector)
  );
}

function filterClauses(
  filters: DnsFilters,
  fields: Record<(typeof FILTER_KEYS)[number], string>,
  exactKeys: readonly (typeof FILTER_KEYS)[number][] = [],
) {
  const clauses: string[] = [];
  for (const key of FILTER_KEYS) {
    if (key === "source" || key === "outcome") continue;
    const value = filters[key].trim();
    if (value && fields[key]) {
      const operator = exactKeys.includes(key) ? "=~" : "contains";
      clauses.push(`| where ${fields[key]} ${operator} ${encodeKqlStringLiteral(value)}`);
    }
  }
  return clauses;
}

function regexTokenClause(field: string, value: string) {
  const escaped = value.toLowerCase().replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return `| where tolower(${field}) matches regex ${encodeKqlStringLiteral(`\\s${escaped}\\s`)}`;
}

function outcomeClauses(source: DnsSourceKind, outcome: string) {
  if (!outcome) return [];
  const normalized = outcome.toLowerCase();
  if (source === "proxy-structured") {
    if (normalized === "response-unknown")
      return [
        '| where isempty(ErrorMessage) and (isempty(tostring(ErrorNumber)) or tostring(ErrorNumber) == "0") and (ResponseCode =~ "NOERROR" or ResponseCode == "0")',
      ];
    if (normalized === "dns-error")
      return [
        '| where isempty(ErrorMessage) and (isempty(tostring(ErrorNumber)) or tostring(ErrorNumber) == "0") and isnotempty(ResponseCode) and ResponseCode !~ "NOERROR" and ResponseCode != "0"',
      ];
    if (normalized === "transport-error")
      return [
        '| where isnotempty(ErrorMessage) or (isnotempty(tostring(ErrorNumber)) and tostring(ErrorNumber) != "0")',
      ];
    if (normalized === "pending")
      return [
        '| where isempty(ResponseCode) and isempty(ErrorMessage) and (isempty(tostring(ErrorNumber)) or tostring(ErrorNumber) == "0")',
      ];
    return ["| where false"];
  }
  if (source === "proxy-legacy") {
    if (normalized === "response-unknown") return ['| where Message contains " NOERROR "'];
    if (normalized === "transport-error")
      return ['| where trim_start(@"\\s+", Message) startswith "Error:"'];
    if (normalized === "dns-error")
      return ['| where Message startswith "DNS Request:" and Message !contains " NOERROR "'];
    return ["| where false"];
  }
  if (source === "flow-trace") {
    if (normalized === "response-unknown") return ['| where MsgType =~ "Client Response"'];
    if (normalized === "pending") return ['| where MsgType !~ "Client Response"'];
    return ["| where false"];
  }
  if (normalized === "blocked") return ['| where Action contains "Deny"'];
  if (normalized === "transport-observed") return ['| where Action !contains "Deny"'];
  return ["| where false"];
}

function matchesCanonicalFilters(observation: DnsObservation, filters: DnsFilters) {
  const equals = (actual: string | undefined, expected: string) =>
    !expected || actual?.trim().toLowerCase() === expected.trim().toLowerCase();
  return (
    equals(observation.queryType, filters.queryType) &&
    equals(observation.protocol, filters.protocol) &&
    equals(observation.outcome, filters.outcome) &&
    equals(observation.source, filters.source)
  );
}

export function buildDnsListQueries(request: DnsListQueryRequest): SourceQuery[] {
  const take = LIST_LIMIT + 1;
  const commonFields = {
    search: 'strcat(QueryName, " ", SourceIp, " ", ResponseCode, " ", ErrorMessage)',
    queryType: "QueryType",
    client: 'strcat(SourceIp, ":", SourcePort)',
    protocol: "Protocol",
    outcome: 'strcat(ResponseCode, " ", ErrorMessage)',
    source: "Category",
  };
  const structuredFilters = filterClauses(request.filters, commonFields, ["queryType", "protocol"]);
  const legacyFilters = filterClauses(request.filters, {
    ...commonFields,
    search: "Message",
    queryType: "Message",
    client: "Message",
    protocol: "Message",
    outcome: "Message",
  });
  if (request.filters.queryType.trim()) {
    legacyFilters.push(regexTokenClause("Message", request.filters.queryType.trim()));
  }
  if (request.filters.protocol.trim()) {
    legacyFilters.push(regexTokenClause("Message", request.filters.protocol.trim()));
  }
  const flowFilters = filterClauses(
    request.filters,
    {
      ...commonFields,
      search: 'strcat(QueryMessage, " ", ServerMessage, " ", SourceIp, " ", ServerIp)',
      queryType: "QueryMessage",
      client: 'strcat(SourceIp, ":", SourcePort)',
      protocol: "Protocol",
      outcome: "ServerMessage",
    },
    ["protocol"],
  );
  const networkFilters = filterClauses(
    request.filters,
    {
      ...commonFields,
      search: 'strcat(SourceIp, " ", DestinationIp, " ", Action, " ", Protocol)',
      queryType: '""',
      client: 'strcat(SourceIp, ":", SourcePort)',
      outcome: "Action",
    },
    ["queryType", "protocol"],
  );

  const queries: SourceQuery[] = [
    {
      source: "proxy-structured",
      query: [
        "AZFWDnsQuery",
        ...structuredFilters,
        ...outcomeClauses("proxy-structured", request.filters.outcome.trim()),
        '| project TimeGenerated, Category="AZFWDnsQuery", ResourceId=_ResourceId, SourceIp, SourcePort, QueryId, QueryType, QueryClass, QueryName, Protocol, RequestSize, DnssecOkBit, EDNS0BufferSize, ResponseCode, ResponseFlags, ResponseSize, RequestDurationSecs, ErrorNumber, ErrorMessage',
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
    {
      source: "proxy-legacy",
      query: [
        "AzureDiagnostics",
        '| where Category == "AzureFirewallDnsProxy"',
        '| where ResourceProvider =~ "MICROSOFT.NETWORK"',
        '| where ResourceType =~ "AZUREFIREWALLS"',
        "| project TimeGenerated, Category, ResourceId=_ResourceId, Message=tostring(msg_s)",
        ...legacyFilters,
        ...outcomeClauses("proxy-legacy", request.filters.outcome.trim()),
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
    {
      source: "flow-trace",
      query: [
        "AZFWDnsFlowTrace",
        '| extend Category="AZFWDnsFlowTrace"',
        ...flowFilters,
        ...outcomeClauses("flow-trace", request.filters.outcome.trim()),
        "| project TimeGenerated, Category, ResourceId=_ResourceId, MsgType, Protocol, QueryMessage, QueryTime, ResponseTime, ServerIp, ServerMessage, ServerPort, SocketFamily, SourceIp, SourcePort",
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
    {
      source: "network-rule",
      query: [
        "AZFWNetworkRule",
        "| where toint(SourcePort) == 53 or toint(DestinationPort) == 53",
        '| where Protocol =~ "TCP" or Protocol =~ "UDP"',
        '| extend Category="AZFWNetworkRule"',
        ...networkFilters,
        ...outcomeClauses("network-rule", request.filters.outcome.trim()),
        "| project TimeGenerated, Category, ResourceId=_ResourceId, Action, Protocol, SourceIp, SourcePort, DestinationIp, DestinationPort, Policy, RuleCollectionGroup, RuleCollection, Rule",
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
  ];
  const sourceFilter = request.filters.source.trim().toLowerCase();
  return sourceFilter
    ? queries.filter((query) => query.source.toLowerCase() === sourceFilter)
    : queries;
}

function tableRows(payload: unknown, maxRows: number) {
  if (!isRecord(payload) || payload.error !== undefined || !Array.isArray(payload.tables)) {
    throw new LogAnalyticsQueryError("upstream");
  }
  const rows: Record<string, unknown>[] = [];
  for (const table of payload.tables) {
    if (!isRecord(table) || !Array.isArray(table.columns) || !Array.isArray(table.rows)) {
      throw new LogAnalyticsQueryError("upstream");
    }
    const names = table.columns.map((column) =>
      isRecord(column) && typeof column.name === "string" ? column.name : "",
    );
    if (names.some((name) => !name)) throw new LogAnalyticsQueryError("upstream");
    for (const row of table.rows) {
      if (!Array.isArray(row)) throw new LogAnalyticsQueryError("upstream");
      rows.push(Object.fromEntries(names.map((name, index) => [name, row[index]])));
      if (rows.length >= maxRows) return rows;
    }
  }
  return rows;
}

function text(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function mapRows(
  payload: unknown,
  source: DnsSourceKind,
  queryId: string,
  maxRows = LIST_LIMIT + 1,
) {
  const rows = tableRows(payload, maxRows);
  const observations = rows
    .map((row, index) => {
      const timestamp = text(row.TimeGenerated);
      if (!timestamp || !Number.isFinite(Date.parse(timestamp)))
        throw new LogAnalyticsQueryError("upstream");
      const category = text(row.Category) ?? "Unknown";
      const message = text(row.Message) ?? text(row.QueryMessage) ?? text(row.ServerMessage) ?? "";
      return parseDnsObservation({
        id: `${queryId}:${source}:${index}`,
        timestamp: new Date(timestamp).toISOString(),
        category,
        action: text(row.Action) ?? (source === "network-rule" ? "Unknown" : "DNS query"),
        protocol: text(row.Protocol) ?? "Unknown",
        sourceIp: text(row.SourceIp),
        sourcePort: text(row.SourcePort),
        destinationIp: text(row.DestinationIp) ?? text(row.ServerIp),
        destinationPort: text(row.DestinationPort) ?? text(row.ServerPort),
        resourceId: text(row.ResourceId),
        message,
        raw: { ...row, properties: row },
        origin: "log-analytics",
      });
    })
    .filter((observation): observation is DnsObservation => observation !== undefined);
  return { observations, truncated: rows.length >= maxRows };
}

export async function executeDnsListQuery(
  target: LogAnalyticsQueryTarget,
  request: DnsListQueryRequest,
  accessToken: string,
  options: ExecuteLogAnalyticsQueryOptions = {},
): Promise<DnsListQueryResponse> {
  const queryId = options.queryId ?? crypto.randomUUID();
  const timespan = `${new Date(request.from).toISOString()}/${new Date(request.to).toISOString()}`;
  const queries = buildDnsListQueries(request);
  if (queries.length === 0) {
    return {
      queriedEntries: [],
      transportObservations: [],
      queriedEntriesTruncated: false,
      transportObservationsTruncated: false,
      sources: [],
    };
  }
  const results = await Promise.allSettled(
    queries.map(async ({ query, source }) => {
      const mapped = mapRows(
        await executeLogAnalyticsRawQuery(target, query, timespan, accessToken, options),
        source,
        queryId,
      );
      return {
        source,
        observations: mapped.observations.filter((observation) =>
          matchesCanonicalFilters(observation, request.filters),
        ),
        truncated: mapped.truncated,
      };
    }),
  );

  const observations: DnsObservation[] = [];
  const sources: DnsSourceStatus[] = [];
  let firstFailure: unknown;
  for (const [index, result] of results.entries()) {
    const source = queries[index]!.source;
    if (result.status === "rejected") {
      firstFailure ??= result.reason;
      const forbidden =
        result.reason instanceof LogAnalyticsQueryError && result.reason.kind === "authorization";
      sources.push({
        source,
        availability: forbidden ? "forbidden" : "failed",
        truncated: false,
        warning: forbidden ? "Source query forbidden" : "Source query failed",
      });
      continue;
    }
    const truncated = result.value.truncated;
    observations.push(...result.value.observations.slice(0, LIST_LIMIT));
    sources.push({ source, availability: "available", truncated });
  }
  if (sources.every((source) => source.availability !== "available")) {
    if (sources.every((source) => source.availability === "forbidden")) throw firstFailure;
    return {
      queriedEntries: [],
      transportObservations: [],
      queriedEntriesTruncated: false,
      transportObservationsTruncated: false,
      sources,
    };
  }

  const transport = observations.filter((observation) => observation.source === "network-rule");
  const entries = createDnsEntries(observations);
  const namedSourceTruncated = sources.some(
    (source) => source.source !== "network-rule" && source.truncated,
  );
  const transportSourceTruncated = sources.some(
    (source) => source.source === "network-rule" && source.truncated,
  );
  const queriedEntries = entries.slice(0, LIST_LIMIT).map((entry) => ({
    ...entry,
    observations: [],
  }));
  return {
    queriedEntries,
    transportObservations: transport.slice(0, LIST_LIMIT),
    queriedEntriesTruncated: namedSourceTruncated || entries.length > LIST_LIMIT,
    transportObservationsTruncated: transportSourceTruncated || transport.length > LIST_LIMIT,
    sources,
  };
}

function selectorClauses(selector: DnsDetailSelector) {
  const timestamp = new Date(selector.timestamp);
  const from = new Date(timestamp.getTime() - 5_000).toISOString();
  const to = new Date(timestamp.getTime() + 5_000).toISOString();
  const nextMillisecond = new Date(timestamp.getTime() + 1).toISOString();
  const clauses = [
    selector.source === "flow-trace"
      ? `| where TimeGenerated between (datetime(${from}) .. datetime(${to}))`
      : `| where TimeGenerated >= datetime(${timestamp.toISOString()}) and TimeGenerated < datetime(${nextMillisecond})`,
    `| where _ResourceId =~ ${encodeKqlStringLiteral(selector.resourceId)}`,
  ];
  if (selector.source !== "proxy-legacy") {
    if (selector.queryId)
      clauses.push(`| where tostring(QueryId) == ${encodeKqlStringLiteral(selector.queryId)}`);
    if (selector.queryName)
      clauses.push(`| where QueryName =~ ${encodeKqlStringLiteral(selector.queryName)}`);
    if (selector.clientIp)
      clauses.push(`| where SourceIp == ${encodeKqlStringLiteral(selector.clientIp)}`);
    if (selector.clientPort)
      clauses.push(
        `| where tostring(SourcePort) == ${encodeKqlStringLiteral(selector.clientPort)}`,
      );
  }
  return clauses;
}

export function buildDnsDetailQuery(selector: DnsDetailSelector) {
  const sourceShape = {
    "proxy-legacy": {
      table: "AzureDiagnostics",
      before: [
        '| where Category == "AzureFirewallDnsProxy"',
        '| where ResourceProvider =~ "MICROSOFT.NETWORK"',
        '| where ResourceType =~ "AZUREFIREWALLS"',
      ],
      projection:
        "| project TimeGenerated, Category, ResourceId=_ResourceId, Message=tostring(msg_s)",
    },
    "proxy-structured": {
      table: "AZFWDnsQuery",
      before: [],
      projection:
        '| project TimeGenerated, Category="AZFWDnsQuery", ResourceId=_ResourceId, SourceIp, SourcePort, QueryId, QueryType, QueryClass, QueryName, Protocol, RequestSize, DnssecOkBit, EDNS0BufferSize, ResponseCode, ResponseFlags, ResponseSize, RequestDurationSecs, ErrorNumber, ErrorMessage',
    },
    "flow-trace": {
      table: "AZFWDnsFlowTrace",
      before: [],
      projection:
        '| project TimeGenerated, Category="AZFWDnsFlowTrace", ResourceId=_ResourceId, MsgType, Protocol, QueryMessage, QueryTime, ResponseTime, ServerIp, ServerMessage, ServerPort, SocketFamily, SourceIp, SourcePort',
    },
    "network-rule": {
      table: "AZFWNetworkRule",
      before: [],
      projection:
        '| project TimeGenerated, Category="AZFWNetworkRule", ResourceId=_ResourceId, Action, Protocol, SourceIp, SourcePort, DestinationIp, DestinationPort, Policy, RuleCollectionGroup, RuleCollection, Rule',
    },
  }[selector.source];
  const clauses = [sourceShape.table, ...sourceShape.before];
  clauses.push(...selectorClauses(selector));
  clauses.push(sourceShape.projection);
  clauses.push("| order by TimeGenerated asc");
  clauses.push(`| take ${DETAIL_LIMIT + 1}`);
  return clauses.join("\n");
}

function matchesSelector(observation: DnsObservation, selector: DnsDetailSelector) {
  return (
    observation.source === selector.source &&
    observation.resourceId?.toLowerCase() === selector.resourceId.toLowerCase() &&
    observation.timestamp === new Date(selector.timestamp).toISOString() &&
    (!selector.queryId || observation.queryId === selector.queryId) &&
    (!selector.queryName ||
      observation.queryName?.toLowerCase() === selector.queryName.toLowerCase()) &&
    (!selector.clientIp || observation.clientIp === selector.clientIp) &&
    (!selector.clientPort || observation.clientPort === selector.clientPort)
  );
}

export async function executeDnsDetailQuery(
  target: LogAnalyticsQueryTarget,
  request: DnsDetailQueryRequest,
  accessToken: string,
  options: ExecuteLogAnalyticsQueryOptions = {},
): Promise<DnsDetailQueryResponse> {
  const timestamp = new Date(request.selector.timestamp);
  const from = new Date(timestamp.getTime() - 5_000).toISOString();
  const to = new Date(timestamp.getTime() + 5_000).toISOString();
  const payload = await executeLogAnalyticsRawQuery(
    target,
    buildDnsDetailQuery(request.selector),
    `${from}/${to}`,
    accessToken,
    options,
  );
  const mapped = mapRows(
    payload,
    request.selector.source,
    options.queryId ?? crypto.randomUUID(),
    DETAIL_LIMIT + 1,
  );
  const observations = mapped.observations.filter((observation) =>
    matchesSelector(observation, request.selector),
  );
  if (observations.length !== 1) {
    return {
      observations: [],
      detailTruncated: mapped.truncated,
      completeness: "partial",
      warnings: [
        observations.length === 0
          ? "Selected DNS entry is no longer available"
          : "Selected DNS entry is ambiguous",
      ],
    };
  }
  const detailTruncated = mapped.truncated;
  return {
    observations,
    detailTruncated,
    completeness: detailTruncated
      ? "range-truncated"
      : observations[0]!.stage === "proxy-exchange"
        ? "complete"
        : "partial",
    warnings: [],
  };
}
