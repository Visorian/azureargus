import type { FirewallLogRecord } from "~/types/firewall";

import type {
  DelegatedLogAnalyticsQueryRequest,
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
  LogAnalyticsSort,
  LogAnalyticsStorageKind,
} from "../../shared/types/logAnalytics";
import { isLogAnalyticsQueryLimit } from "../../shared/utils/logAnalytics";
import { AZURE_DIAGNOSTICS_NETWORK_PROJECTION } from "./azureDiagnosticsLogAnalytics";

const MAX_RANGE_MS = 24 * 60 * 60 * 1000;
const MAX_FILTER_LENGTH = 256;
const MAX_CATEGORY_FILTERS = 32;
const DEFAULT_TIMEOUT_MS = 15_000;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILTER_KEYS = ["search", "category", "action", "protocol", "source", "destination"] as const;
const TEXT_FILTER_KEYS = ["search", "action", "protocol", "source", "destination"] as const;
const SORT_COLUMNS: Record<LogAnalyticsSort["key"], string> = {
  timestamp: "TimeGenerated",
  category: "tolower(Category)",
  action: "tolower(Action)",
  protocol: "tolower(Protocol)",
  sourceIp: "tolower(SourceIp)",
  sourcePort: "tolower(SourcePort)",
  destinationIp: "tolower(DestinationIp)",
  destinationPort: "tolower(DestinationPort)",
  ruleCollection: "tolower(RuleCollection)",
  rule: "tolower(Rule)",
  message: "tolower(Message)",
};
const REQUIRED_RESULT_COLUMNS = [
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
] as const;

const RESOURCE_SPECIFIC_BASE_QUERY = `union isfuzzy=true withsource=Category AZFWNetworkRule, AZFWApplicationRule, AZFWNatRule
| project
    TimeGenerated,
    Category = tostring(Category),
    Action = iff(Category == "AZFWNatRule", "DNAT", tostring(column_ifexists("Action", ""))),
    Protocol = tostring(column_ifexists("Protocol", "")),
    SourceIp = tostring(column_ifexists("SourceIp", "")),
    SourcePort = tostring(column_ifexists("SourcePort", "")),
    DestinationIp = tostring(column_ifexists("DestinationIp", "")),
    DestinationFqdn = tostring(column_ifexists("Fqdn", "")),
    DestinationPort = tostring(column_ifexists("DestinationPort", "")),
    Policy = tostring(column_ifexists("Policy", "")),
    RuleCollectionGroup = tostring(column_ifexists("RuleCollectionGroup", "")),
    RuleCollection = tostring(column_ifexists("RuleCollection", "")),
    Rule = tostring(column_ifexists("Rule", "")),
    ActionReason = tostring(column_ifexists("ActionReason", ""))`;

const CANONICAL_QUERY_SUFFIX = `| extend Rule = iff(
    isempty(Rule) and ActionReason contains "default action",
    "Default",
    Rule
  )
| extend DestinationAddress = iff(isnotempty(DestinationIp), DestinationIp, DestinationFqdn)
| extend Message = strcat(
    Action,
    " ",
    Protocol,
    " from ",
    SourceIp,
    iff(isempty(SourcePort), "", strcat(":", SourcePort)),
    " to ",
    DestinationAddress,
    iff(isempty(DestinationPort), "", strcat(":", DestinationPort)),
    iff(isempty(Policy), "", strcat(" policy ", Policy)),
    iff(isempty(RuleCollectionGroup), "", strcat(" collection group ", RuleCollectionGroup)),
    iff(isempty(RuleCollection), "", strcat(" collection ", RuleCollection)),
    iff(isempty(Rule), "", strcat(" rule ", Rule))
  )
| project
    TimeGenerated,
    Category,
    Action,
    Protocol,
    SourceIp,
    SourcePort,
    DestinationIp = DestinationAddress,
    DestinationFqdn,
    DestinationPort,
    Policy,
    RuleCollectionGroup,
    RuleCollection,
    Rule,
    Message
| extend SearchableText = strcat(
    tostring(TimeGenerated), " ",
    Category, " ",
    Action, " ",
    Protocol, " ",
    SourceIp, " ",
    SourcePort, " ",
    DestinationIp, " ",
    DestinationPort, " ",
    Policy, " ",
    RuleCollectionGroup, " ",
    RuleCollection, " ",
    Rule, " ",
    Message
  )`;

export type LogAnalyticsQueryErrorKind = "authorization" | "throttled" | "timeout" | "upstream";

export class LogAnalyticsQueryError extends Error {
  readonly kind: LogAnalyticsQueryErrorKind;
  readonly retryAfterSeconds?: number;

  constructor(kind: LogAnalyticsQueryErrorKind, retryAfterSeconds?: number) {
    super("Log Analytics query failed");
    this.name = "LogAnalyticsQueryError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]) {
  const actualKeys = Object.keys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key) => expectedKeys.includes(key))
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function isValidFilterObject(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, FILTER_KEYS)) {
    return false;
  }

  return (
    Array.isArray(value.category) &&
    value.category.length <= MAX_CATEGORY_FILTERS &&
    value.category.every(
      (category) =>
        typeof category === "string" &&
        category.trim().length > 0 &&
        category.length <= MAX_FILTER_LENGTH,
    ) &&
    TEXT_FILTER_KEYS.every((key) => {
      const filterValue = value[key];
      return typeof filterValue === "string" && filterValue.length <= MAX_FILTER_LENGTH;
    })
  );
}

function isValidSortObject(value: unknown) {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["key", "direction"]) &&
    typeof value.key === "string" &&
    Object.hasOwn(SORT_COLUMNS, value.key) &&
    (value.direction === "asc" || value.direction === "desc")
  );
}

function isLogAnalyticsStorageKind(value: unknown): value is LogAnalyticsStorageKind {
  return value === "resource-specific" || value === "azure-diagnostics";
}

function readRetryAfterSeconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

function errorForResponse(response: Response) {
  if (response.status === 401 || response.status === 403) {
    return new LogAnalyticsQueryError("authorization");
  }
  if (response.status === 429) {
    return new LogAnalyticsQueryError("throttled", readRetryAfterSeconds(response));
  }

  return new LogAnalyticsQueryError("upstream");
}

function readCell(row: unknown[], columnIndexes: Map<string, number>, columnName: string) {
  const index = columnIndexes.get(columnName);
  if (index === undefined) {
    throw new LogAnalyticsQueryError("upstream");
  }

  return row[index];
}

function readTextCell(row: unknown[], columnIndexes: Map<string, number>, columnName: string) {
  const value = readCell(row, columnIndexes, columnName);
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    throw new LogAnalyticsQueryError("upstream");
  }

  return value;
}

function optionalText(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function compareRecords(left: FirewallLogRecord, right: FirewallLogRecord, sort: LogAnalyticsSort) {
  let result: number;
  if (sort.key === "timestamp") {
    result = Date.parse(left.timestamp) - Date.parse(right.timestamp);
  } else {
    result = (left[sort.key] ?? "")
      .toLowerCase()
      .localeCompare((right[sort.key] ?? "").toLowerCase());
  }

  if (result === 0) {
    result = left.id.localeCompare(right.id);
  }

  return sort.direction === "asc" ? result : -result;
}

function mapTableRows(table: Record<string, unknown>, tableIndex: number, queryId: string) {
  if (!Array.isArray(table.columns) || !Array.isArray(table.rows)) {
    throw new LogAnalyticsQueryError("upstream");
  }

  const columnIndexes = new Map<string, number>();
  for (const [columnIndex, column] of table.columns.entries()) {
    if (!isRecord(column) || typeof column.name !== "string" || columnIndexes.has(column.name)) {
      throw new LogAnalyticsQueryError("upstream");
    }
    columnIndexes.set(column.name, columnIndex);
  }
  if (REQUIRED_RESULT_COLUMNS.some((columnName) => !columnIndexes.has(columnName))) {
    throw new LogAnalyticsQueryError("upstream");
  }

  const records: FirewallLogRecord[] = [];
  for (const [rowIndex, row] of table.rows.entries()) {
    if (!Array.isArray(row)) {
      throw new LogAnalyticsQueryError("upstream");
    }

    const timestampValue = readTextCell(row, columnIndexes, "TimeGenerated");
    const timestampMs = Date.parse(timestampValue);
    if (!Number.isFinite(timestampMs)) {
      throw new LogAnalyticsQueryError("upstream");
    }

    const timestamp = new Date(timestampMs).toISOString();
    const category = readTextCell(row, columnIndexes, "Category");
    const action = readTextCell(row, columnIndexes, "Action");
    const protocol = readTextCell(row, columnIndexes, "Protocol");
    const sourceIp = optionalText(readTextCell(row, columnIndexes, "SourceIp"));
    const sourcePort = optionalText(readTextCell(row, columnIndexes, "SourcePort"));
    const projectedDestination = optionalText(readTextCell(row, columnIndexes, "DestinationIp"));
    const destinationFqdn = optionalText(readTextCell(row, columnIndexes, "DestinationFqdn"));
    const destinationIp = projectedDestination ?? destinationFqdn;
    const destinationPort = optionalText(readTextCell(row, columnIndexes, "DestinationPort"));
    const policy = optionalText(readTextCell(row, columnIndexes, "Policy"));
    const ruleCollectionGroup = optionalText(
      readTextCell(row, columnIndexes, "RuleCollectionGroup"),
    );
    const ruleCollection = optionalText(readTextCell(row, columnIndexes, "RuleCollection"));
    const rule = optionalText(readTextCell(row, columnIndexes, "Rule"));
    const message = readTextCell(row, columnIndexes, "Message");
    const raw = {
      TimeGenerated: timestamp,
      Category: category,
      Action: action,
      Protocol: protocol,
      SourceIp: sourceIp,
      SourcePort: sourcePort,
      DestinationIp: projectedDestination,
      DestinationFqdn: destinationFqdn,
      DestinationPort: destinationPort,
      Policy: policy,
      RuleCollectionGroup: ruleCollectionGroup,
      RuleCollection: ruleCollection,
      Rule: rule,
      Message: message,
    };
    const searchableText = [
      timestamp,
      category,
      action,
      protocol,
      sourceIp,
      sourcePort,
      destinationIp,
      destinationPort,
      policy,
      ruleCollectionGroup,
      ruleCollection,
      rule,
      message,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    records.push({
      id: `${queryId}:${tableIndex}:${rowIndex}`,
      timestamp,
      category,
      action,
      protocol,
      sourceIp,
      sourcePort,
      destinationIp,
      destinationPort,
      policy,
      ruleCollectionGroup,
      ruleCollection,
      rule,
      message,
      raw,
      searchableText,
    });
  }

  return records;
}

export function validateLogAnalyticsQueryRequest(
  value: unknown,
): value is LogAnalyticsQueryRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["from", "to", "filters", "limit", "storage", "sort"]) ||
    !isIsoTimestamp(value.from) ||
    !isIsoTimestamp(value.to) ||
    !isValidFilterObject(value.filters) ||
    !isLogAnalyticsQueryLimit(value.limit) ||
    !isLogAnalyticsStorageKind(value.storage) ||
    !isValidSortObject(value.sort)
  ) {
    return false;
  }

  const from = Date.parse(value.from);
  const to = Date.parse(value.to);
  return from < to && to - from <= MAX_RANGE_MS;
}

export function validateDelegatedLogAnalyticsQueryRequest(
  value: unknown,
): value is DelegatedLogAnalyticsQueryRequest {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["workspaceId", "from", "to", "filters", "limit", "storage", "sort"])
  ) {
    return false;
  }

  const { workspaceId, ...request } = value;
  return (
    typeof workspaceId === "string" &&
    WORKSPACE_ID_PATTERN.test(workspaceId) &&
    validateLogAnalyticsQueryRequest(request)
  );
}

export function encodeKqlStringLiteral(value: string) {
  return JSON.stringify(value);
}

export function getLogAnalyticsResultLimit(request: LogAnalyticsQueryRequest) {
  return request.limit;
}

function buildLogAnalyticsQueryForSource(request: LogAnalyticsQueryRequest, baseQuery: string) {
  const clauses = [baseQuery, CANONICAL_QUERY_SUFFIX];
  const filters = {
    search: "SearchableText",
    action: "Action",
    protocol: "Protocol",
    source: 'strcat(SourceIp, ":", SourcePort)',
    destination: 'strcat(DestinationIp, ":", DestinationPort)',
  } as const;

  const categories = [
    ...new Set(
      request.filters.category
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  ].toSorted();
  if (categories.length > 0) {
    clauses.push(`| where Category in~ (${categories.map(encodeKqlStringLiteral).join(", ")})`);
  }

  for (const key of TEXT_FILTER_KEYS) {
    const value = request.filters[key].trim().toLowerCase();
    if (value.length > 0) {
      clauses.push(`| where ${filters[key]} contains ${encodeKqlStringLiteral(value)}`);
    }
  }

  const limit = getLogAnalyticsResultLimit(request);
  clauses.push(`| order by ${SORT_COLUMNS[request.sort.key]} ${request.sort.direction}`);
  clauses.push(`| take ${limit + 1}`);

  return { query: clauses.join("\n"), limit };
}

export function buildLogAnalyticsQuery(request: LogAnalyticsQueryRequest) {
  return buildLogAnalyticsQueryForSource(request, RESOURCE_SPECIFIC_BASE_QUERY);
}

export function buildAzureDiagnosticsLogAnalyticsQuery(request: LogAnalyticsQueryRequest) {
  return buildLogAnalyticsQueryForSource(request, AZURE_DIAGNOSTICS_NETWORK_PROJECTION);
}

export function mapLogAnalyticsResponse(
  value: unknown,
  sort: LogAnalyticsSort,
  queryId: string,
  limit: number,
): LogAnalyticsQueryResponse {
  if (!isRecord(value) || value.error !== undefined || !Array.isArray(value.tables)) {
    throw new LogAnalyticsQueryError("upstream");
  }

  const records: FirewallLogRecord[] = [];
  for (const [tableIndex, table] of value.tables.entries()) {
    if (!isRecord(table)) {
      throw new LogAnalyticsQueryError("upstream");
    }
    records.push(...mapTableRows(table, tableIndex, queryId));
  }

  records.sort((left, right) => compareRecords(left, right, sort));
  return {
    records: records.slice(0, limit),
    truncated: records.length > limit,
    limit,
  };
}

export interface ExecuteLogAnalyticsQueryOptions {
  fetchImplementation?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
  queryId?: string;
}

export interface LogAnalyticsQueryTarget {
  workspaceId: string;
}

export async function executeLogAnalyticsRawQuery(
  target: LogAnalyticsQueryTarget,
  query: string,
  timespan: string | undefined,
  accessToken: string,
  options: ExecuteLogAnalyticsQueryOptions = {},
) {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch;
  const controller = new AbortController();
  let timedOut = false;
  const handleIncomingAbort = () => controller.abort();
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener("abort", handleIncomingAbort, { once: true });
  }

  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetchImplementation(
        `https://api.loganalytics.azure.com/v1/workspaces/${encodeURIComponent(target.workspaceId)}/query`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(timespan === undefined ? { query } : { query, timespan }),
          signal: controller.signal,
        },
      );
    } catch {
      throw new LogAnalyticsQueryError(timedOut ? "timeout" : "upstream");
    }

    if (!response.ok) {
      throw errorForResponse(response);
    }

    try {
      return (await response.json()) as unknown;
    } catch {
      throw new LogAnalyticsQueryError("upstream");
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", handleIncomingAbort);
  }
}

export async function executeLogAnalyticsQuery(
  target: LogAnalyticsQueryTarget,
  request: LogAnalyticsQueryRequest,
  accessToken: string,
  options: ExecuteLogAnalyticsQueryOptions = {},
) {
  const selectedQuery =
    request.storage === "azure-diagnostics"
      ? buildAzureDiagnosticsLogAnalyticsQuery(request)
      : buildLogAnalyticsQuery(request);
  const timespan = `${new Date(request.from).toISOString()}/${new Date(request.to).toISOString()}`;
  const queryId = options.queryId ?? crypto.randomUUID();
  const sourceQueryId =
    request.storage === "azure-diagnostics" ? `${queryId}:azure-diagnostics` : queryId;
  return mapLogAnalyticsResponse(
    await executeLogAnalyticsRawQuery(target, selectedQuery.query, timespan, accessToken, options),
    request.sort,
    sourceQueryId,
    selectedQuery.limit,
  );
}
