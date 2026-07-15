import type {
  FirewallLogRecord,
  FirewallLogSortDirection,
  FirewallLogSortKey,
} from "~/types/firewall";

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

export type LogAnalyticsStorageKind = "resource-specific" | "azure-diagnostics";

export interface LogAnalyticsQueryRequest {
  from: string;
  to: string;
  filters: LogAnalyticsFilters;
  limit: number;
  storage: LogAnalyticsStorageKind;
  sort: LogAnalyticsSort;
}

export interface DelegatedLogAnalyticsQueryRequest extends LogAnalyticsQueryRequest {
  workspaceId: string;
}

export interface LogAnalyticsQueryResponse {
  records: FirewallLogRecord[];
  truncated: boolean;
  limit: number;
}
