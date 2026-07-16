import type { FirewallLogFilters, FirewallLogSortState } from "~/types/firewall";

export const LOG_ANALYSIS_CATEGORIES = [
  "AZFWApplicationRule",
  "AZFWNatRule",
  "AZFWNetworkRule",
] as const;

export const LOG_ANALYSIS_ACTIONS = ["Allow", "Deny", "DNAT", "SNAT"] as const;
export const LOG_ANALYSIS_PROTOCOLS = ["HTTP", "HTTPS", "ICMP", "MSSQL", "TCP", "UDP"] as const;
export const LOG_ANALYSIS_MAX_RANGE_MS = 24 * 60 * 60 * 1000;

export interface LogAnalysisDateRange {
  from: string;
  to: string;
}

type LogAnalysisDateRangeResult =
  | { ok: true; value: { from: string; to: string } }
  | { error: string; ok: false };

function padDatePart(value: number) {
  return String(value).padStart(2, "0");
}

export function formatDateTimeLocal(date: Date) {
  return [
    date.getFullYear(),
    "-",
    padDatePart(date.getMonth() + 1),
    "-",
    padDatePart(date.getDate()),
    "T",
    padDatePart(date.getHours()),
    ":",
    padDatePart(date.getMinutes()),
  ].join("");
}

export function createDefaultLogAnalysisDateRange(now = new Date()): LogAnalysisDateRange {
  return {
    from: formatDateTimeLocal(new Date(now.getTime() - 15 * 60_000)),
    to: formatDateTimeLocal(now),
  };
}

export function parseLogAnalysisDateRange(range: LogAnalysisDateRange): LogAnalysisDateRangeResult {
  const from = new Date(range.from);
  const to = new Date(range.to);
  const fromTimestamp = from.getTime();
  const toTimestamp = to.getTime();

  if (!Number.isFinite(fromTimestamp) || !Number.isFinite(toTimestamp)) {
    return { error: "Start and end dates are required.", ok: false };
  }
  if (fromTimestamp >= toTimestamp) {
    return { error: "Start date must be before end date.", ok: false };
  }
  if (toTimestamp - fromTimestamp > LOG_ANALYSIS_MAX_RANGE_MS) {
    return { error: "Log Analytics range cannot exceed 24 hours.", ok: false };
  }

  return {
    ok: true,
    value: {
      from: from.toISOString(),
      to: to.toISOString(),
    },
  };
}

export function getLogAnalysisCriteriaKey(filters: FirewallLogFilters, sort: FirewallLogSortState) {
  return [
    filters.search,
    filters.category
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
      .toSorted()
      .join("\u001E"),
    filters.action,
    filters.protocol,
    filters.source,
    filters.destination,
    sort.key,
    sort.direction,
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u001F");
}
