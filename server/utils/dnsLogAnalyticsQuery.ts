import type {
  DelegatedDnsDetailQueryRequest,
  DelegatedDnsListQueryRequest,
  DelegatedDnsReadinessRequest,
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsDetailSelector,
  DnsFilters,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsObservation,
  DnsRawProjection,
  DnsReadinessResponse,
  DnsReadinessSourceKind,
  DnsRelatedEvidence,
  DnsRelatedSourceKind,
  DnsRelatedSourceStatus,
  DnsSourceKind,
  DnsSourceReadiness,
  DnsSourceStatus,
} from "../../shared/types/dns";
import type { LogAnalyticsStorageKind } from "../../shared/types/logAnalytics";
import { createHash } from "node:crypto";
import { createDnsEntries, parseDnsObservation } from "../../shared/utils/dns";
import { DNS_READINESS_SOURCE_DEFINITIONS } from "../../shared/utils/dnsReadiness";
import { AZURE_DIAGNOSTICS_NETWORK_PROJECTION } from "./azureDiagnosticsLogAnalytics";
import { isLogAnalyticsQueryLimit } from "../../shared/utils/logAnalytics";
import {
  encodeKqlStringLiteral,
  executeLogAnalyticsRawQuery,
  LogAnalyticsQueryError,
  type ExecuteLogAnalyticsQueryOptions,
  type LogAnalyticsQueryTarget,
} from "./logAnalyticsQuery";

const MAX_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_FILTER_LENGTH = 256;
const MAX_SELECTOR_TEXT_LENGTH = 2_048;
const DETAIL_LIMIT = 200;
const RELATED_DETAIL_LIMIT = 50;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TRAILING_DOTS_PATTERN = /\.+$/;
const FIREWALL_RESOURCE_ID_PATTERN =
  /^\/subscriptions\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\/resourceGroups\/[^/]{1,90}\/providers\/Microsoft\.Network\/azureFirewalls\/[^/]{1,260}$/i;
const SOURCE_KINDS = [
  "proxy-structured",
  "dns-flow-trace",
  "internal-fqdn-failure",
  "network-rule",
] as const;
const RELATED_SOURCE_KINDS = ["application-rule", "flow-trace", "nat-rule"] as const;
const FILTER_KEYS = ["search", "queryType", "client", "protocol", "outcome", "source"] as const;
const LOG_ANALYTICS_STORAGE_KINDS = ["resource-specific", "azure-diagnostics"] as const;
interface SourceQuery {
  source: DnsSourceKind;
  storage: LogAnalyticsStorageKind;
  query: string;
}

interface ReadinessProbe {
  sources: readonly DnsReadinessSourceKind[];
  storage: LogAnalyticsStorageKind;
  query: string;
}

type ReadinessAttempt =
  | {
      source: DnsReadinessSourceKind;
      storage: LogAnalyticsStorageKind;
      status: "success";
      sampleCount: 0 | 1 | 2;
    }
  | {
      source: DnsReadinessSourceKind;
      storage: LogAnalyticsStorageKind;
      status: "missing" | "forbidden" | "failed";
      sampleCount: null;
    };

type LogAnalyticsIdentitySource = DnsReadinessSourceKind | "network-rule:azure-diagnostics";

interface RelatedEvidenceQuery {
  source: DnsRelatedSourceKind;
  query: string;
  timespan: string;
  matchBasis: string;
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
    hasExactKeys(value, ["from", "to", "filters", "limit", "storage"]) &&
    isIsoTimestamp(value.from) &&
    isIsoTimestamp(value.to) &&
    validRange(value.from, value.to) &&
    isFilters(value.filters) &&
    isLogAnalyticsQueryLimit(value.limit) &&
    LOG_ANALYTICS_STORAGE_KINDS.includes(value.storage as LogAnalyticsStorageKind)
  );
}

export function validateDelegatedDnsListQueryRequest(
  value: unknown,
): value is DelegatedDnsListQueryRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["workspaceId", "from", "to", "filters", "limit", "storage"])
  ) {
    return false;
  }
  const { workspaceId, ...request } = value;
  return (
    typeof workspaceId === "string" &&
    WORKSPACE_ID_PATTERN.test(workspaceId) &&
    validateDnsListQueryRequest(request)
  );
}

export function validateDelegatedDnsReadinessRequest(
  value: unknown,
): value is DelegatedDnsReadinessRequest {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["workspaceId"]) &&
    typeof value.workspaceId === "string" &&
    WORKSPACE_ID_PATTERN.test(value.workspaceId)
  );
}

function isDetailSelector(value: unknown): value is DnsDetailSelector {
  if (
    !isRecord(value) ||
    !SOURCE_KINDS.includes(value.source as (typeof SOURCE_KINDS)[number]) ||
    typeof value.resourceId !== "string" ||
    !FIREWALL_RESOURCE_ID_PATTERN.test(value.resourceId) ||
    !isIsoTimestamp(value.timestamp)
  ) {
    return false;
  }
  if (value.source === "network-rule") {
    const keys = [
      "source",
      "resourceId",
      "timestamp",
      "logAnalyticsStorage",
      "protocol",
      "networkSourceIp",
      "networkSourcePort",
      "networkDestinationIp",
      "networkDestinationPort",
    ] as const;
    return (
      hasExactKeys(value, keys) &&
      LOG_ANALYTICS_STORAGE_KINDS.includes(value.logAnalyticsStorage as LogAnalyticsStorageKind) &&
      keys.slice(4).every((key) => {
        const field = value[key];
        return typeof field === "string" && field.length > 0 && field.length <= 256;
      })
    );
  }
  if (value.source === "dns-flow-trace") {
    const optionalKeys = [
      "msgType",
      "queryMessage",
      "serverMessage",
      "queryTime",
      "responseTime",
      "socketFamily",
      "clientIp",
      "clientPort",
      "serverIp",
      "serverPort",
    ] as const;
    if (!hasOnlyKeys(value, ["source", "resourceId", "timestamp", ...optionalKeys])) return false;
    return (
      optionalKeys.some((key) => value[key] !== undefined) &&
      optionalKeys.every(
        (key) =>
          value[key] === undefined ||
          (typeof value[key] === "string" &&
            value[key].length > 0 &&
            value[key].length <= MAX_SELECTOR_TEXT_LENGTH),
      )
    );
  }
  if (value.source === "internal-fqdn-failure") {
    const optionalKeys = [
      "queryName",
      "serverIp",
      "serverPort",
      "errorMessage",
      "policy",
      "ruleCollectionGroup",
      "ruleCollection",
      "rule",
    ] as const;
    if (!hasOnlyKeys(value, ["source", "resourceId", "timestamp", ...optionalKeys])) return false;
    return (
      typeof value.queryName === "string" &&
      value.queryName.length > 0 &&
      optionalKeys.every(
        (key) =>
          value[key] === undefined ||
          (typeof value[key] === "string" &&
            value[key].length > 0 &&
            value[key].length <= MAX_SELECTOR_TEXT_LENGTH),
      )
    );
  }
  const optionalKeys = ["queryId", "queryName", "clientIp", "clientPort"] as const;
  if (!hasOnlyKeys(value, ["source", "resourceId", "timestamp", ...optionalKeys])) return false;
  return optionalKeys.every(
    (key) =>
      value[key] === undefined ||
      (typeof value[key] === "string" &&
        value[key].length > 0 &&
        value[key].length <= MAX_SELECTOR_TEXT_LENGTH),
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
  const take = request.limit + 1;
  const commonFields = {
    search: 'strcat(QueryName, " ", SourceIp, " ", ResponseCode, " ", ErrorMessage)',
    queryType: "QueryType",
    client: 'strcat(SourceIp, ":", SourcePort)',
    protocol: "Protocol",
    outcome: 'strcat(ResponseCode, " ", ErrorMessage)',
    source: "Category",
  };
  const structuredFilters = filterClauses(request.filters, commonFields, ["queryType", "protocol"]);
  const networkFilters = filterClauses(
    request.filters,
    {
      ...commonFields,
      search:
        'strcat(SourceIp, " ", SourcePort, " ", DestinationIp, " ", DestinationPort, " ", Action, " ", Protocol, " ", Policy, " ", RuleCollectionGroup, " ", RuleCollection, " ", Rule)',
      queryType: '""',
      client:
        'iff(toint(DestinationPort) == 53 and toint(SourcePort) != 53, strcat(SourceIp, ":", SourcePort), iff(toint(SourcePort) == 53 and toint(DestinationPort) != 53, strcat(DestinationIp, ":", DestinationPort), ""))',
      outcome: "Action",
    },
    ["queryType", "protocol"],
  );
  const flowFilters = filterClauses(
    request.filters,
    {
      ...commonFields,
      search:
        'strcat(MsgType, " ", QueryMessage, " ", ServerMessage, " ", SourceIp, " ", SourcePort, " ", ServerIp, " ", ServerPort)',
      queryType: '""',
      client: 'strcat(SourceIp, ":", SourcePort)',
      outcome: '""',
    },
    ["protocol"],
  );
  if (request.filters.queryType.trim() || request.filters.outcome.trim()) {
    flowFilters.push("| where false");
  }
  const internalFilters = filterClauses(request.filters, {
    ...commonFields,
    search:
      'strcat(Fqdn, " ", Error, " ", ServerIp, " ", ServerPort, " ", Policy, " ", RuleCollectionGroup, " ", RuleCollection, " ", Rule)',
    queryType: '""',
    client: '""',
    protocol: '""',
    outcome: '""',
  });
  if (
    request.filters.queryType.trim() ||
    request.filters.client.trim() ||
    request.filters.protocol.trim() ||
    (request.filters.outcome.trim() && request.filters.outcome.trim() !== "dns-error")
  ) {
    internalFilters.push("| where false");
  }

  const queries: SourceQuery[] = [
    {
      source: "proxy-structured",
      storage: "resource-specific",
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
      source: "dns-flow-trace",
      storage: "resource-specific",
      query: [
        "AZFWDnsFlowTrace",
        ...flowFilters,
        '| project TimeGenerated, Category="AZFWDnsFlowTrace", ResourceId=_ResourceId, MsgType, Protocol, QueryMessage, QueryTime, ResponseTime, ServerIp, ServerPort, ServerMessage, SocketFamily, SourceIp, SourcePort',
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
    {
      source: "internal-fqdn-failure",
      storage: "resource-specific",
      query: [
        "AZFWInternalFqdnResolutionFailure",
        ...internalFilters,
        '| project TimeGenerated, Category="AZFWInternalFqdnResolutionFailure", ResourceId=_ResourceId, Fqdn, Error, ServerIp, ServerPort, Policy, RuleCollectionGroup, RuleCollection, Rule',
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
    {
      source: "network-rule",
      storage: "resource-specific",
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
    {
      source: "network-rule",
      storage: "azure-diagnostics",
      query: [
        AZURE_DIAGNOSTICS_NETWORK_PROJECTION,
        "| where toint(SourcePort) == 53 or toint(DestinationPort) == 53",
        '| where Protocol =~ "TCP" or Protocol =~ "UDP"',
        ...networkFilters,
        ...outcomeClauses("network-rule", request.filters.outcome.trim()),
        "| order by TimeGenerated desc",
        `| take ${take}`,
      ].join("\n"),
    },
  ];
  const sourceFilter = request.filters.source.trim().toLowerCase();
  return queries.filter(
    (query) =>
      query.storage === request.storage &&
      (!sourceFilter || query.source.toLowerCase() === sourceFilter),
  );
}

export function buildDnsReadinessProbes(): ReadinessProbe[] {
  return DNS_READINESS_SOURCE_DEFINITIONS.flatMap<ReadinessProbe>(
    ({ source, resourceSpecificTable, azureDiagnosticsCategory }) =>
      LOG_ANALYTICS_STORAGE_KINDS.map((storage) => {
        const sourceQuery =
          storage === "resource-specific"
            ? [resourceSpecificTable]
            : [
                "AzureDiagnostics",
                '| where ResourceProvider =~ "MICROSOFT.NETWORK"',
                '| where ResourceType =~ "AZUREFIREWALLS"',
                `| where Category == ${encodeKqlStringLiteral(azureDiagnosticsCategory)}`,
              ];
        return {
          sources: [source],
          storage,
          query: [
            "let MissingTable = view () { print IsMissing = 1, SampleCount = toint(0) };",
            "union isfuzzy=true MissingTable,",
            "(",
            ...sourceQuery,
            "| take 2",
            "| count",
            "| project IsMissing = 0, SampleCount = toint(Count)",
            ")",
            "| top 1 by IsMissing asc",
            "| project TableExists = IsMissing == 0, SampleCount",
          ].join("\n"),
        };
      }),
  );
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

function isReadinessSampleCount(value: unknown): value is 0 | 1 | 2 {
  return value === 0 || value === 1 || value === 2;
}

function readinessProbeResult(payload: unknown) {
  const rows = tableRows(payload, 1);
  const tableExists = rows[0]?.TableExists;
  const sampleCount = rows[0]?.SampleCount;
  if (rows.length !== 1 || typeof tableExists !== "boolean") {
    throw new LogAnalyticsQueryError("upstream");
  }
  if (!isReadinessSampleCount(sampleCount)) throw new LogAnalyticsQueryError("upstream");
  if (!tableExists && sampleCount !== 0) throw new LogAnalyticsQueryError("upstream");
  return { tableExists, sampleCount };
}

export async function executeDnsReadinessQuery(
  target: LogAnalyticsQueryTarget,
  accessToken: string,
  options: ExecuteLogAnalyticsQueryOptions = {},
): Promise<DnsReadinessResponse> {
  const probes = buildDnsReadinessProbes();
  const results = await Promise.allSettled(
    probes.map(({ query }) =>
      executeLogAnalyticsRawQuery(target, query, undefined, accessToken, options),
    ),
  );

  const attempts = results.flatMap<ReadinessAttempt>((result, index): ReadinessAttempt[] => {
    const probe = probes[index]!;
    if (result.status === "fulfilled") {
      try {
        const { tableExists, sampleCount } = readinessProbeResult(result.value);
        return probe.sources.map((source) =>
          tableExists
            ? {
                source,
                storage: probe.storage,
                status: "success" as const,
                sampleCount,
              }
            : {
                source,
                storage: probe.storage,
                status: "missing" as const,
                sampleCount: null,
              },
        );
      } catch {
        return probe.sources.map((source) => ({
          source,
          storage: probe.storage,
          status: "failed" as const,
          sampleCount: null,
        }));
      }
    }
    const forbidden =
      result.reason instanceof LogAnalyticsQueryError && result.reason.kind === "authorization";
    return probe.sources.map((source) => ({
      source,
      storage: probe.storage,
      status: forbidden ? ("forbidden" as const) : ("failed" as const),
      sampleCount: null,
    }));
  });
  const readiness = DNS_READINESS_SOURCE_DEFINITIONS.flatMap<DnsSourceReadiness>(({ source }) =>
    LOG_ANALYTICS_STORAGE_KINDS.map((storage) => {
      const attempt = attempts.find(
        (candidate) => candidate.source === source && candidate.storage === storage,
      );
      if (!attempt) throw new LogAnalyticsQueryError("upstream");
      return attempt;
    }),
  );
  return { readiness };
}

function text(value: unknown) {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : undefined;
}

function canonicalValue(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "number") return `number:${Object.is(value, -0) ? "-0" : String(value)}`;
  if (typeof value === "boolean") return `boolean:${String(value)}`;
  if (Array.isArray(value)) return `array:[${value.map(canonicalValue).join(",")}]`;
  if (isRecord(value)) {
    return `object:{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(",")}}`;
  }
  throw new LogAnalyticsQueryError("upstream");
}

function defaultIdentityDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function assignStableLogAnalyticsRowIds(
  source: LogAnalyticsIdentitySource,
  rows: readonly Record<string, unknown>[],
  digest: (value: string) => string = defaultIdentityDigest,
) {
  const prepared = rows.map((row, index) => {
    const canonical = canonicalValue({ source, row });
    return { canonical, digest: digest(canonical), index, row };
  });
  const byDigest = Map.groupBy(prepared, (item) => item.digest);
  const assigned: Array<{
    collision: boolean;
    id: string;
    row: Record<string, unknown>;
  }> = [];

  for (const [identityDigest, digestGroup] of byDigest) {
    const byCanonical = Map.groupBy(digestGroup, (item) => item.canonical);
    const canonicalKeys = [...byCanonical.keys()].toSorted();
    const collision = canonicalKeys.length > 1;
    for (const [collisionIndex, canonical] of canonicalKeys.entries()) {
      const occurrences = byCanonical.get(canonical)!;
      const collisionSuffix = collision ? `:collision-${collisionIndex + 1}` : "";
      for (const [occurrenceIndex, item] of occurrences.entries()) {
        assigned[item.index] = {
          collision,
          id: `la:${source}:${identityDigest}${collisionSuffix}:${occurrenceIndex + 1}`,
          row: item.row,
        };
      }
    }
  }

  return assigned;
}

function identitySource(
  source: DnsSourceKind,
  storage: LogAnalyticsStorageKind,
): LogAnalyticsIdentitySource {
  if (storage === "resource-specific") return source;
  if (source === "network-rule") return "network-rule:azure-diagnostics";
  throw new LogAnalyticsQueryError("upstream");
}

function mapRows(
  payload: unknown,
  source: DnsSourceKind,
  maxRows: number,
  storage: LogAnalyticsStorageKind = "resource-specific",
) {
  const rows = tableRows(payload, maxRows);
  const observations = assignStableLogAnalyticsRowIds(identitySource(source, storage), rows)
    .map(({ collision, id, row }) => {
      const timestamp = text(row.TimeGenerated);
      if (!timestamp || !Number.isFinite(Date.parse(timestamp)))
        throw new LogAnalyticsQueryError("upstream");
      const category = text(row.Category) ?? "Unknown";
      const message = text(row.Message) ?? text(row.QueryMessage) ?? text(row.ServerMessage) ?? "";
      const observation = parseDnsObservation({
        id,
        timestamp: new Date(timestamp).toISOString(),
        category,
        ...(source === "network-rule" ? { logAnalyticsStorage: storage } : {}),
        action: text(row.Action) ?? (source === "network-rule" ? "Unknown" : "DNS query"),
        protocol: text(row.Protocol) ?? "Unknown",
        sourceIp: text(row.SourceIp),
        sourcePort: text(row.SourcePort),
        destinationIp: text(row.DestinationIp) ?? text(row.ServerIp),
        destinationPort: text(row.DestinationPort) ?? text(row.ServerPort),
        policy: text(row.Policy),
        ruleCollectionGroup: text(row.RuleCollectionGroup),
        ruleCollection: text(row.RuleCollection),
        rule: text(row.Rule),
        resourceId: text(row.ResourceId),
        message,
        raw: { ...row, properties: row },
        origin: "log-analytics",
      });
      if (!observation || !collision) return observation;
      return {
        ...observation,
        warnings: [...observation.warnings, "Log Analytics observation identity hash collision"],
      };
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
  const timespan = `${new Date(request.from).toISOString()}/${new Date(request.to).toISOString()}`;
  const queries = buildDnsListQueries(request);
  const results = await Promise.allSettled(
    queries.map(async ({ query, source, storage }) => {
      const mapped = mapRows(
        await executeLogAnalyticsRawQuery(target, query, timespan, accessToken, options),
        source,
        request.limit + 1,
        storage,
      );
      return {
        source,
        storage,
        observations: mapped.observations.filter((observation) =>
          matchesCanonicalFilters(observation, request.filters),
        ),
        truncated: mapped.truncated,
      };
    }),
  );

  const observations: DnsObservation[] = [];
  const sources: DnsSourceStatus[] = [];
  const sourceOrder = [...new Set(queries.map((query) => query.source))];
  for (const source of sourceOrder) {
    const sourceResults = results.filter((_, index) => queries[index]!.source === source);
    const fulfilled = sourceResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : [],
    );
    for (const result of fulfilled) {
      observations.push(...result.observations.slice(0, request.limit));
    }
    const hasFailure = sourceResults.some((result) => result.status === "rejected");
    const hasObservations = fulfilled.some((result) => result.observations.length > 0);
    if (fulfilled.length > 0 && (!hasFailure || hasObservations)) {
      sources.push({
        source,
        availability: "available",
        truncated: fulfilled.some((result) => result.truncated),
      });
      continue;
    }
    const forbidden = sourceResults.some(
      (result) =>
        result.status === "rejected" &&
        result.reason instanceof LogAnalyticsQueryError &&
        result.reason.kind === "authorization",
    );
    sources.push({
      source,
      availability: forbidden ? "forbidden" : "failed",
      truncated: false,
      warning: forbidden ? "Source query forbidden" : "Source query failed",
    });
  }
  if (sources.every((source) => source.availability !== "available")) {
    return {
      queriedEntries: [],
      transportObservations: [],
      queriedEntriesTruncated: false,
      transportObservationsTruncated: false,
      sources,
    };
  }

  const transport = observations
    .filter((observation) => observation.source === "network-rule")
    .toSorted(
      (left, right) =>
        right.timestamp.localeCompare(left.timestamp) || right.id.localeCompare(left.id),
    );
  const entries = createDnsEntries(observations);
  const namedSourceTruncated = sources.some(
    (source) => source.source !== "network-rule" && source.truncated,
  );
  const transportSourceTruncated = sources.some(
    (source) => source.source === "network-rule" && source.truncated,
  );
  const queriedEntries = entries.slice(0, request.limit).map((entry) => ({
    ...entry,
    observations: [],
  }));
  return {
    queriedEntries,
    transportObservations: transport.slice(0, request.limit),
    queriedEntriesTruncated: namedSourceTruncated || entries.length > request.limit,
    transportObservationsTruncated: transportSourceTruncated || transport.length > request.limit,
    sources,
  };
}

function selectorClauses(selector: DnsDetailSelector, resourceField = "_ResourceId") {
  const timestamp = new Date(selector.timestamp);
  const nextMillisecond = new Date(timestamp.getTime() + 1).toISOString();
  const clauses = [
    `| where TimeGenerated >= datetime(${timestamp.toISOString()}) and TimeGenerated < datetime(${nextMillisecond})`,
    `| where ${resourceField} =~ ${encodeKqlStringLiteral(selector.resourceId)}`,
  ];
  if (selector.source === "network-rule") {
    clauses.push(
      `| where Protocol =~ ${encodeKqlStringLiteral(selector.protocol!)}`,
      `| where SourceIp == ${encodeKqlStringLiteral(selector.networkSourceIp!)}`,
      `| where tostring(SourcePort) == ${encodeKqlStringLiteral(selector.networkSourcePort!)}`,
      `| where DestinationIp == ${encodeKqlStringLiteral(selector.networkDestinationIp!)}`,
      `| where tostring(DestinationPort) == ${encodeKqlStringLiteral(selector.networkDestinationPort!)}`,
    );
  } else if (selector.source === "dns-flow-trace") {
    const fields = [
      ["MsgType", selector.msgType, false],
      ["QueryMessage", selector.queryMessage, false],
      ["ServerMessage", selector.serverMessage, false],
      ["QueryTime", selector.queryTime, false],
      ["ResponseTime", selector.responseTime, false],
      ["SocketFamily", selector.socketFamily, true],
      ["SourceIp", selector.clientIp, false],
      ["SourcePort", selector.clientPort, false],
      ["ServerIp", selector.serverIp, false],
      ["ServerPort", selector.serverPort, false],
    ] as const;
    for (const [field, value, caseInsensitive] of fields) {
      if (!value) continue;
      clauses.push(
        `| where tostring(${field}) ${caseInsensitive ? "=~" : "=="} ${encodeKqlStringLiteral(value)}`,
      );
    }
  } else if (selector.source === "internal-fqdn-failure") {
    const fields = [
      ["Fqdn", selector.queryName, true],
      ["Error", selector.errorMessage, false],
      ["ServerIp", selector.serverIp, false],
      ["ServerPort", selector.serverPort, false],
      ["Policy", selector.policy, false],
      ["RuleCollectionGroup", selector.ruleCollectionGroup, false],
      ["RuleCollection", selector.ruleCollection, false],
      ["Rule", selector.rule, false],
    ] as const;
    for (const [field, value, caseInsensitive] of fields) {
      if (!value) continue;
      clauses.push(
        `| where tostring(${field}) ${caseInsensitive ? "=~" : "=="} ${encodeKqlStringLiteral(value)}`,
      );
    }
  } else {
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
  if (selector.source === "dns-proxy") {
    throw new TypeError("Event Hub DNS proxy entries do not use Log Analytics detail queries");
  }
  if (selector.source === "network-rule" && selector.logAnalyticsStorage === "azure-diagnostics") {
    return [
      AZURE_DIAGNOSTICS_NETWORK_PROJECTION,
      ...selectorClauses(selector, "ResourceId"),
      "| order by TimeGenerated asc",
      `| take ${DETAIL_LIMIT + 1}`,
    ].join("\n");
  }
  const sourceShape = {
    "proxy-structured": {
      table: "AZFWDnsQuery",
      before: [],
      projection:
        '| project TimeGenerated, Category="AZFWDnsQuery", ResourceId=_ResourceId, SourceIp, SourcePort, QueryId, QueryType, QueryClass, QueryName, Protocol, RequestSize, DnssecOkBit, EDNS0BufferSize, ResponseCode, ResponseFlags, ResponseSize, RequestDurationSecs, ErrorNumber, ErrorMessage',
    },
    "dns-flow-trace": {
      table: "AZFWDnsFlowTrace",
      before: [],
      projection:
        '| project TimeGenerated, Category="AZFWDnsFlowTrace", ResourceId=_ResourceId, MsgType, Protocol, QueryMessage, QueryTime, ResponseTime, ServerIp, ServerPort, ServerMessage, SocketFamily, SourceIp, SourcePort',
    },
    "internal-fqdn-failure": {
      table: "AZFWInternalFqdnResolutionFailure",
      before: [],
      projection:
        '| project TimeGenerated, Category="AZFWInternalFqdnResolutionFailure", ResourceId=_ResourceId, Fqdn, Error, ServerIp, ServerPort, Policy, RuleCollectionGroup, RuleCollection, Rule',
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
    (!selector.logAnalyticsStorage ||
      observation.logAnalyticsStorage === selector.logAnalyticsStorage) &&
    observation.resourceId?.toLowerCase() === selector.resourceId.toLowerCase() &&
    observation.timestamp === new Date(selector.timestamp).toISOString() &&
    (!selector.queryId || observation.queryId === selector.queryId) &&
    (!selector.queryName ||
      observation.queryName?.toLowerCase() === selector.queryName.toLowerCase()) &&
    (!selector.clientIp || observation.clientIp === selector.clientIp) &&
    (!selector.clientPort || observation.clientPort === selector.clientPort) &&
    (!selector.protocol || observation.protocol === selector.protocol) &&
    (!selector.networkSourceIp || observation.networkSourceIp === selector.networkSourceIp) &&
    (!selector.networkSourcePort || observation.networkSourcePort === selector.networkSourcePort) &&
    (!selector.networkDestinationIp ||
      observation.networkDestinationIp === selector.networkDestinationIp) &&
    (!selector.networkDestinationPort ||
      observation.networkDestinationPort === selector.networkDestinationPort) &&
    (!selector.msgType || observation.msgType === selector.msgType) &&
    (!selector.queryMessage || observation.queryMessage === selector.queryMessage) &&
    (!selector.serverMessage || observation.serverMessage === selector.serverMessage) &&
    (!selector.queryTime || observation.queryTime === selector.queryTime) &&
    (!selector.responseTime || observation.responseTime === selector.responseTime) &&
    (!selector.socketFamily ||
      observation.socketFamily?.toLowerCase() === selector.socketFamily.toLowerCase()) &&
    (!selector.serverIp || observation.serverIp === selector.serverIp) &&
    (!selector.serverPort || observation.serverPort === selector.serverPort) &&
    (!selector.errorMessage || observation.errorMessage === selector.errorMessage) &&
    (!selector.policy || observation.policy === selector.policy) &&
    (!selector.ruleCollectionGroup ||
      observation.ruleCollectionGroup === selector.ruleCollectionGroup) &&
    (!selector.ruleCollection || observation.ruleCollection === selector.ruleCollection) &&
    (!selector.rule || observation.rule === selector.rule)
  );
}

function relatedTimespan(timestamp: string, beforeMs: number, afterMs: number) {
  const time = Date.parse(timestamp);
  return `${new Date(time - beforeMs).toISOString()}/${new Date(time + afterMs).toISOString()}`;
}

export function buildDnsRelatedEvidenceQueries(
  observation: DnsObservation,
): RelatedEvidenceQuery[] {
  if (!observation.resourceId || observation.logAnalyticsStorage === "azure-diagnostics") return [];
  const resourceClause = `| where _ResourceId =~ ${encodeKqlStringLiteral(observation.resourceId)}`;
  const queries: RelatedEvidenceQuery[] = [];
  const fqdn = observation.queryName?.replace(TRAILING_DOTS_PATTERN, "");
  if (fqdn && observation.clientIp) {
    queries.push({
      source: "application-rule",
      timespan: relatedTimespan(observation.timestamp, 5_000, 60_000),
      matchBasis: "same firewall, client IP, FQDN, and -5s/+60s window",
      query: [
        "AZFWApplicationRule",
        resourceClause,
        `| where SourceIp == ${encodeKqlStringLiteral(observation.clientIp)}`,
        `| where Fqdn in~ (${encodeKqlStringLiteral(fqdn)}, ${encodeKqlStringLiteral(`${fqdn}.`)})`,
        '| project TimeGenerated, Category="AZFWApplicationRule", ResourceId=_ResourceId, Action, ActionReason, Protocol, SourceIp, SourcePort, DestinationPort, Fqdn, TargetUrl, Policy, RuleCollectionGroup, RuleCollection, Rule',
        "| order by TimeGenerated asc",
        `| take ${RELATED_DETAIL_LIMIT + 1}`,
      ].join("\n"),
    });
  }
  if (
    observation.protocol?.toUpperCase() === "TCP" &&
    observation.clientIp &&
    observation.clientPort &&
    observation.serverIp
  ) {
    queries.push({
      source: "flow-trace",
      timespan: relatedTimespan(observation.timestamp, 5_000, 5_000),
      matchBasis: "same firewall, TCP client socket, DNS server, and ±5s window",
      query: [
        "AZFWFlowTrace",
        resourceClause,
        '| where Protocol =~ "TCP"',
        `| where (SourceIp == ${encodeKqlStringLiteral(observation.clientIp)} and tostring(SourcePort) == ${encodeKqlStringLiteral(observation.clientPort)} and DestinationIp == ${encodeKqlStringLiteral(observation.serverIp)} and toint(DestinationPort) == 53) or (DestinationIp == ${encodeKqlStringLiteral(observation.clientIp)} and tostring(DestinationPort) == ${encodeKqlStringLiteral(observation.clientPort)} and SourceIp == ${encodeKqlStringLiteral(observation.serverIp)} and toint(SourcePort) == 53)`,
        '| project TimeGenerated, Category="AZFWFlowTrace", ResourceId=_ResourceId, Action, ActionReason, Flag, Protocol, SourceIp, SourcePort, DestinationIp, DestinationPort',
        "| order by TimeGenerated asc",
        `| take ${RELATED_DETAIL_LIMIT + 1}`,
      ].join("\n"),
    });
  }
  if (
    (observation.protocol?.toUpperCase() === "TCP" ||
      observation.protocol?.toUpperCase() === "UDP") &&
    observation.clientIp &&
    observation.clientPort &&
    observation.serverIp
  ) {
    queries.push({
      source: "nat-rule",
      timespan: relatedTimespan(observation.timestamp, 5_000, 5_000),
      matchBasis: "same firewall, client socket, DNS server, protocol, and ±5s window",
      query: [
        "AZFWNatRule",
        resourceClause,
        `| where Protocol =~ ${encodeKqlStringLiteral(observation.protocol)}`,
        `| where SourceIp == ${encodeKqlStringLiteral(observation.clientIp)} and tostring(SourcePort) == ${encodeKqlStringLiteral(observation.clientPort)}`,
        "| where toint(DestinationPort) == 53 or toint(TranslatedPort) == 53",
        `| where DestinationIp == ${encodeKqlStringLiteral(observation.serverIp)} or TranslatedIp == ${encodeKqlStringLiteral(observation.serverIp)}`,
        '| project TimeGenerated, Category="AZFWNatRule", ResourceId=_ResourceId, Protocol, SourceIp, SourcePort, DestinationIp, DestinationPort, TranslatedIp, TranslatedPort, Policy, RuleCollectionGroup, RuleCollection, Rule',
        "| order by TimeGenerated asc",
        `| take ${RELATED_DETAIL_LIMIT + 1}`,
      ].join("\n"),
    });
  }
  return queries;
}

function mapRelatedRows(
  payload: unknown,
  source: DnsRelatedSourceKind,
  matchBasis: string,
): { evidence: DnsRelatedEvidence[]; truncated: boolean } {
  const rows = tableRows(payload, RELATED_DETAIL_LIMIT + 1);
  const evidence = assignStableLogAnalyticsRowIds(source, rows)
    .slice(0, RELATED_DETAIL_LIMIT)
    .map<DnsRelatedEvidence>(({ id, row }) => {
      const timestamp = text(row.TimeGenerated);
      if (!timestamp || !Number.isFinite(Date.parse(timestamp))) {
        throw new LogAnalyticsQueryError("upstream");
      }
      const raw: DnsRawProjection = {};
      for (const [key, value] of Object.entries(row)) {
        if (typeof value === "string") raw[key] = value.slice(0, 2_048);
        else if (typeof value === "number" || typeof value === "boolean" || value === null) {
          raw[key] = value;
        }
      }
      return {
        id,
        timestamp: new Date(timestamp).toISOString(),
        source,
        matchBasis,
        action: text(row.Action),
        actionReason: text(row.ActionReason),
        protocol: text(row.Protocol),
        sourceIp: text(row.SourceIp),
        sourcePort: text(row.SourcePort),
        destinationIp: text(row.DestinationIp),
        destinationPort: text(row.DestinationPort),
        queryName: text(row.Fqdn),
        targetUrl: text(row.TargetUrl),
        flag: text(row.Flag),
        translatedIp: text(row.TranslatedIp),
        translatedPort: text(row.TranslatedPort),
        policy: text(row.Policy),
        ruleCollectionGroup: text(row.RuleCollectionGroup),
        ruleCollection: text(row.RuleCollection),
        rule: text(row.Rule),
        resourceId: text(row.ResourceId),
        raw,
      };
    });
  return { evidence, truncated: rows.length > RELATED_DETAIL_LIMIT };
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
    DETAIL_LIMIT + 1,
    request.selector.logAnalyticsStorage ?? "resource-specific",
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
  const relatedQueries = buildDnsRelatedEvidenceQueries(observations[0]!);
  const relatedResults = await Promise.allSettled(
    relatedQueries.map(async ({ source, query, timespan, matchBasis }) => ({
      source,
      ...mapRelatedRows(
        await executeLogAnalyticsRawQuery(target, query, timespan, accessToken, options),
        source,
        matchBasis,
      ),
    })),
  );
  const relatedEvidence: DnsRelatedEvidence[] = [];
  const relatedSources: DnsRelatedSourceStatus[] = RELATED_SOURCE_KINDS.map((source) => ({
    source,
    availability: "not-applicable",
    truncated: false,
  }));
  for (const [index, result] of relatedResults.entries()) {
    const source = relatedQueries[index]!.source;
    const status = relatedSources.find((item) => item.source === source)!;
    if (result.status === "fulfilled") {
      relatedEvidence.push(...result.value.evidence);
      status.availability = "available";
      status.truncated = result.value.truncated;
      continue;
    }
    const forbidden =
      result.reason instanceof LogAnalyticsQueryError && result.reason.kind === "authorization";
    status.availability = forbidden ? "forbidden" : "failed";
    status.warning = forbidden ? "Related source query forbidden" : "Related source query failed";
  }
  return {
    observations,
    relatedEvidence,
    relatedSources,
    detailTruncated,
    completeness: detailTruncated
      ? "range-truncated"
      : observations[0]!.stage === "proxy-exchange"
        ? "complete"
        : "partial",
    warnings: observations[0]!.warnings,
  };
}
