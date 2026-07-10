import type {
  FirewallLogRecord,
  FirewallLogSortDirection,
  FirewallLogSortKey,
} from "~/types/firewall";

export const LOG_ANALYSIS_ROLE = "LogAnalysis.Read";

export interface LogAnalyticsFilters {
  search: string;
  category: string;
  action: string;
  protocol: string;
  source: string;
  destination: string;
}

export interface LogAnalyticsSort {
  key: FirewallLogSortKey;
  direction: FirewallLogSortDirection;
}

export interface LogAnalyticsQueryRequest {
  from: string;
  to: string;
  filters: LogAnalyticsFilters;
  sort: LogAnalyticsSort;
}

export interface LogAnalyticsQueryResponse {
  records: FirewallLogRecord[];
  truncated: boolean;
  limit: number;
}
