export interface FirewallLogRecord {
  id: string;
  timestamp: string;
  category: string;
  action: string;
  protocol: string;
  sourceIp?: string;
  sourcePort?: string;
  destinationIp?: string;
  destinationPort?: string;
  ruleCollection?: string;
  rule?: string;
  message: string;
  raw: unknown;
  partitionId?: string;
  sequenceNumber?: string;
  enqueuedTimeUtc?: string;
  searchableText: string;
}

export type FirewallLogSortKey =
  | "timestamp"
  | "category"
  | "action"
  | "protocol"
  | "sourceIp"
  | "sourcePort"
  | "destinationIp"
  | "destinationPort"
  | "ruleCollection"
  | "rule"
  | "message";

export type FirewallLogSortDirection = "asc" | "desc";

export interface FirewallLogSortState {
  key: FirewallLogSortKey;
  direction: FirewallLogSortDirection;
}

export interface FirewallLogFilters {
  search: string;
  category: string;
  action: string;
  protocol: string;
  source: string;
  destination: string;
  from: string;
  to: string;
}
