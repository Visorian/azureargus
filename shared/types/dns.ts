export type DnsSourceKind =
  | "dns-proxy"
  | "proxy-structured"
  | "dns-flow-trace"
  | "internal-fqdn-failure"
  | "network-rule";

export type DnsRelatedSourceKind = "application-rule" | "flow-trace" | "nat-rule";

export type DnsReadinessSourceKind = DnsSourceKind | DnsRelatedSourceKind;

export type DnsStage = "proxy-exchange" | "dns-flow-trace" | "internal-resolution" | "transport";

export type DnsPathKind = "proxy" | "direct" | "internal" | "unknown";

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

export type DnsSourceAvailability = "available" | "forbidden" | "failed";

export interface DnsRawProjection {
  [key: string]: boolean | number | string | null | undefined;
}

export interface DnsObservation {
  id: string;
  timestamp: string;
  enqueuedTimeUtc?: string;
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
  networkSourceIp?: string;
  networkSourcePort?: string;
  networkDestinationIp?: string;
  networkDestinationPort?: string;
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
  msgType?: string;
  queryMessage?: string;
  serverMessage?: string;
  queryTime?: string;
  responseTime?: string;
  socketFamily?: string;
  action?: string;
  policy?: string;
  ruleCollectionGroup?: string;
  ruleCollection?: string;
  rule?: string;
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
  protocol?: string;
  networkSourceIp?: string;
  networkSourcePort?: string;
  networkDestinationIp?: string;
  networkDestinationPort?: string;
  msgType?: string;
  queryMessage?: string;
  serverMessage?: string;
  queryTime?: string;
  responseTime?: string;
  socketFamily?: string;
  serverIp?: string;
  serverPort?: string;
  errorMessage?: string;
  policy?: string;
  ruleCollectionGroup?: string;
  ruleCollection?: string;
  rule?: string;
}

export interface DnsEntry {
  id: string;
  timestamp: string;
  displayText?: string;
  queryName?: string;
  queryType?: string;
  client?: string;
  destination?: string;
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
      source: DnsReadinessSourceKind;
      status: "success";
      sampleCount: 0 | 1 | 2;
    }
  | {
      source: DnsReadinessSourceKind;
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

export interface DnsRelatedEvidence {
  id: string;
  timestamp: string;
  source: DnsRelatedSourceKind;
  matchBasis: string;
  action?: string;
  actionReason?: string;
  protocol?: string;
  sourceIp?: string;
  sourcePort?: string;
  destinationIp?: string;
  destinationPort?: string;
  queryName?: string;
  targetUrl?: string;
  flag?: string;
  translatedIp?: string;
  translatedPort?: string;
  policy?: string;
  ruleCollectionGroup?: string;
  ruleCollection?: string;
  rule?: string;
  resourceId?: string;
  raw: DnsRawProjection;
}

export interface DnsRelatedSourceStatus {
  source: DnsRelatedSourceKind;
  availability: DnsSourceAvailability | "not-applicable";
  truncated: boolean;
  warning?: string;
}

export interface DnsDetailQueryResponse {
  observations: DnsObservation[];
  relatedEvidence?: DnsRelatedEvidence[];
  relatedSources?: DnsRelatedSourceStatus[];
  detailTruncated: boolean;
  completeness: DnsTraceCompleteness;
  warnings: string[];
}
