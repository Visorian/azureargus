export type DnsSourceKind = "proxy-legacy" | "proxy-structured" | "flow-trace" | "network-rule";

export type DnsStage =
  | "client-query"
  | "forwarder-query"
  | "forwarder-response"
  | "client-response"
  | "proxy-exchange"
  | "transport"
  | "error";

export type DnsPathKind = "proxy" | "direct" | "flow-trace" | "unknown";

export type DnsOutcome =
  | "answer-observed"
  | "no-data"
  | "response-unknown"
  | "dns-error"
  | "blocked"
  | "transport-error"
  | "transport-observed"
  | "pending";

export type DnsTraceCompleteness =
  | "complete"
  | "partial"
  | "range-truncated"
  | "source-unavailable";

export type DnsCorrelationConfidence = "explicit" | "exact-derived" | "likely" | "uncorrelated";

export type DnsSourceAvailability =
  | "available"
  | "not-configured"
  | "unsupported-table-plan"
  | "forbidden"
  | "failed";

export interface DnsRawProjection {
  [key: string]: boolean | number | string | null | undefined;
}

export interface DnsObservation {
  id: string;
  timestamp: string;
  source: DnsSourceKind;
  stage: DnsStage;
  path: DnsPathKind;
  outcome: DnsOutcome;
  resourceId?: string;
  queryName?: string;
  queryId?: string;
  queryType?: string;
  queryClass?: string;
  clientIp?: string;
  clientPort?: string;
  serverIp?: string;
  serverPort?: string;
  protocol?: string;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
  dnssecOk?: boolean;
  ednsBufferSizeBytes?: number;
  responseCode?: string;
  responseFlags: string[];
  durationSeconds?: number;
  errorNumber?: string;
  errorMessage?: string;
  queryMessage?: string;
  serverMessage?: string;
  queryTime?: string;
  responseTime?: string;
  action?: string;
  attempt?: number;
  parseState: "parsed" | "partial" | "unparsed";
  warnings: string[];
  raw: DnsRawProjection;
}

export interface DnsDetailSelector {
  source: DnsSourceKind;
  resourceId: string;
  timestamp: string;
  queryId?: string;
  queryName?: string;
  clientIp?: string;
  clientPort?: string;
}

export interface DnsEntry {
  id: string;
  timestamp: string;
  queryName?: string;
  queryType?: string;
  client?: string;
  protocol?: string;
  path: DnsPathKind;
  outcome: DnsOutcome;
  durationSeconds?: number;
  observationCount: number;
  completeness: DnsTraceCompleteness;
  confidence: DnsCorrelationConfidence;
  source: DnsSourceKind;
  warnings: string[];
  observations: DnsObservation[];
  detailSelector?: DnsDetailSelector;
}

export interface DnsFilters {
  search: string;
  queryType: string;
  client: string;
  protocol: string;
  outcome: string;
  source: string;
}

export interface DnsFilterOptions {
  outcomes: DnsOutcome[];
  protocols: string[];
  queryTypes: string[];
  sources: string[];
}

export type DnsSortKey = "timestamp" | "queryName" | "duration" | "observations";

export interface DnsSort {
  key: DnsSortKey;
  direction: "asc" | "desc";
}

export interface DnsListQueryRequest {
  from: string;
  to: string;
  filters: DnsFilters;
  limit: number;
}

export interface DelegatedDnsListQueryRequest extends DnsListQueryRequest {
  workspaceId: string;
}

export interface DelegatedDnsReadinessRequest {
  workspaceId: string;
}

export interface DnsDetailQueryRequest {
  selector: DnsDetailSelector;
}

export interface DelegatedDnsDetailQueryRequest extends DnsDetailQueryRequest {
  workspaceId: string;
}

export interface DnsSourceStatus {
  source: DnsSourceKind;
  availability: DnsSourceAvailability;
  truncated: boolean;
  warning?: string;
}

export type DnsSourceReadiness =
  | {
      source: DnsSourceKind;
      status: "success";
      sampleCount: 0 | 1 | 2;
    }
  | {
      source: DnsSourceKind;
      status: "forbidden" | "failed";
      sampleCount: null;
    };

export interface DnsReadinessResponse {
  readiness: DnsSourceReadiness[];
}

export interface DnsListQueryResponse {
  queriedEntries: DnsEntry[];
  transportObservations: DnsObservation[];
  queriedEntriesTruncated: boolean;
  transportObservationsTruncated: boolean;
  sources: DnsSourceStatus[];
}

export interface DnsDetailQueryResponse {
  observations: DnsObservation[];
  detailTruncated: boolean;
  completeness: DnsTraceCompleteness;
  warnings: string[];
}
