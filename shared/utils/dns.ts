import type {
  DnsDetailSelector,
  DnsEntry,
  DnsObservation,
  DnsOutcome,
  DnsRawProjection,
  DnsSourceKind,
  DnsStage,
} from "../types/dns";

export const DNS_OUTCOME_LABELS: Readonly<Record<DnsOutcome, string>> = {
  "answer-observed": "Answer observed",
  "no-data": "No data",
  "response-unknown": "Response received",
  "dns-error": "DNS error",
  blocked: "Blocked by firewall",
  "transport-error": "Transport error",
  "transport-observed": "Transport observed",
  pending: "Pending or partial",
};

const RAW_FIELD_LIMIT = 2_048;
const RAW_PROJECTION_LIMIT = 8_192;
const DNS_PROXY_MESSAGE_LIMIT = 8_192;
const QUERY_NAME_LIMIT = 1_024;
const CANONICAL_TEXT_LIMIT = 2_048;
const SHORT_TEXT_LIMIT = 256;
const CODE_LIMIT = 64;
const DNS_PROXY_SUCCESS_PATTERN =
  /^DNS Request:\s*(?<client>\S+)\s+[-–]\s+(?<queryId>\d+)\s+(?<queryType>\S+)\s+(?<queryClass>\S+)\s+(?<queryName>\S+)\s+(?<protocol>\S+)\s+(?<requestSize>\d+)\s+(?<dnssecOk>true|false)\s+(?<ednsBuffer>\d+)\s+(?<responseCode>\S+)\s+(?<flags>\S+)\s+(?<responseSize>\d+)\s+(?<duration>\d+(?:\.\d+)?)s$/i;
const DNS_PROXY_ERROR_PATTERN =
  /^\s*Error:\s*(?<errorNumber>\d+)\s+(?<queryName>\S+)\s+(?<queryType>[^:]+):\s*(?<errorMessage>.+)$/i;
const BRACKETED_ENDPOINT_PATTERN = /^\[(?<ip>.+)](?::(?<port>\d+))?$/;

export interface DnsRecordInput {
  id: string;
  timestamp: string;
  enqueuedTimeUtc?: string;
  category: string;
  action: string;
  protocol: string;
  sourceIp?: string;
  sourcePort?: string;
  destinationIp?: string;
  destinationPort?: string;
  policy?: string;
  ruleCollectionGroup?: string;
  ruleCollection?: string;
  rule?: string;
  resourceId?: string;
  message: string;
  raw: unknown;
  origin?: "event-hub" | "log-analytics";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(raw: unknown) {
  const record = isRecord(raw) ? raw : {};
  const properties = isRecord(record.properties) ? record.properties : {};
  return { properties, record };
}

function readValue(
  record: Record<string, unknown>,
  properties: Record<string, unknown>,
  keys: readonly string[],
) {
  for (const key of keys) {
    if (properties[key] !== undefined && properties[key] !== null) {
      return properties[key];
    }
    if (record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return undefined;
}

function readText(
  record: Record<string, unknown>,
  properties: Record<string, unknown>,
  keys: readonly string[],
) {
  const value = readValue(record, properties, keys);
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  return typeof value === "number" ? String(value) : undefined;
}

function readNumber(
  record: Record<string, unknown>,
  properties: Record<string, unknown>,
  keys: readonly string[],
) {
  const value = readValue(record, properties, keys);
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function readBoolean(
  record: Record<string, unknown>,
  properties: Record<string, unknown>,
  keys: readonly string[],
) {
  const value = readValue(record, properties, keys);
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return undefined;
}

function splitEndpoint(value: string | undefined) {
  if (!value) return {};
  if (value.startsWith("[")) {
    const match = value.match(BRACKETED_ENDPOINT_PATTERN);
    return { ip: match?.groups?.ip, port: match?.groups?.port };
  }
  const separator = value.lastIndexOf(":");
  if (separator <= 0 || value.indexOf(":") !== separator) return { ip: value };
  return { ip: value.slice(0, separator), port: value.slice(separator + 1) };
}

function getOutcome(
  responseCode: string | undefined,
  errorMessage?: string,
  errorNumber?: string,
): DnsOutcome {
  if (errorMessage || (errorNumber && errorNumber !== "0")) return "transport-error";
  if (!responseCode) return "pending";
  const normalized = responseCode.toUpperCase();
  return normalized === "NOERROR" || normalized === "0" ? "response-unknown" : "dns-error";
}

function boundedText(value: unknown, limit = RAW_FIELD_LIMIT) {
  if (typeof value === "string") return value.slice(0, limit);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  return undefined;
}

function projectRaw(raw: unknown) {
  const { properties, record } = readRecord(raw);
  const projection: DnsRawProjection = {};
  const warnings: string[] = [];
  let remaining = RAW_PROJECTION_LIMIT;
  for (const key of [
    "TimeGenerated",
    "time",
    "Category",
    "category",
    "ResourceId",
    "resourceId",
    "MsgType",
    "QueryId",
    "QueryName",
    "QueryType",
    "QueryClass",
    "Protocol",
    "SourceIp",
    "SourcePort",
    "DestinationIp",
    "DestinationPort",
    "ServerIp",
    "ServerPort",
    "Policy",
    "RuleCollectionGroup",
    "RuleCollection",
    "Rule",
    "ResponseCode",
    "ResponseFlags",
    "RequestSize",
    "ResponseSize",
    "RequestDurationSecs",
    "ErrorNumber",
    "ErrorMessage",
    "Error",
    "Fqdn",
    "QueryMessage",
    "QueryTime",
    "ResponseTime",
    "ServerMessage",
    "SocketFamily",
    "msg",
    "Message",
  ]) {
    const original = properties[key] ?? record[key];
    const limit = Math.min(RAW_FIELD_LIMIT, remaining);
    const value = boundedText(original, limit);
    if (value !== undefined) {
      projection[key] = value;
      if (typeof value === "string") remaining -= value.length;
      if (
        typeof original === "string" &&
        original.length > (typeof value === "string" ? value.length : 0)
      ) {
        warnings.push(`Raw ${key} truncated`);
      }
      if (remaining <= 0) break;
    }
  }
  return { projection, warnings };
}

function canonicalText(
  value: string | undefined,
  label: string,
  warnings: string[],
  limit = CANONICAL_TEXT_LIMIT,
) {
  if (!value || value.length <= limit) return value;
  warnings.push(`${label} truncated`);
  return value.slice(0, limit);
}

function canonicalFlags(value: string | undefined, warnings: string[]) {
  const bounded = canonicalText(value, "Response flags", warnings, SHORT_TEXT_LIMIT);
  if (!bounded || bounded === "-") return [];
  const flags = bounded.split(",");
  if (flags.length > 32) warnings.push("Response flag count truncated");
  return flags.slice(0, 32).map((flag) => {
    const trimmed = flag.trim();
    if (trimmed.length > CODE_LIMIT) warnings.push("Response flag truncated");
    return trimmed.slice(0, CODE_LIMIT);
  });
}

function baseObservation(
  input: DnsRecordInput,
  source: DnsSourceKind,
  stage: DnsStage,
): DnsObservation {
  const raw = projectRaw(input.raw);
  const warnings = [...raw.warnings];
  return {
    id: input.id,
    timestamp: input.timestamp,
    enqueuedTimeUtc: input.enqueuedTimeUtc,
    source,
    stage,
    path:
      source === "network-rule"
        ? "direct"
        : source === "internal-fqdn-failure"
          ? "internal"
          : "proxy",
    outcome: "pending",
    resourceId: canonicalText(input.resourceId, "Resource ID", warnings, 1_024),
    protocol:
      input.protocol === "Unknown"
        ? undefined
        : canonicalText(input.protocol, "Protocol", warnings, CODE_LIMIT),
    responseFlags: [],
    parseState: "parsed",
    warnings,
    raw: raw.projection,
  };
}

function parseDnsProxyMessage(input: DnsRecordInput): DnsObservation | undefined {
  if (input.message.length > DNS_PROXY_MESSAGE_LIMIT) return undefined;
  const observation = baseObservation(input, "dns-proxy", "proxy-exchange");
  const match = input.message.match(DNS_PROXY_SUCCESS_PATTERN);
  if (!match?.groups) {
    const errorMatch = input.message.match(DNS_PROXY_ERROR_PATTERN);
    if (!errorMatch?.groups) return undefined;
    const warnings = [...observation.warnings];
    return {
      ...observation,
      queryName: canonicalText(
        errorMatch.groups.queryName,
        "Query name",
        warnings,
        QUERY_NAME_LIMIT,
      ),
      queryType: canonicalText(errorMatch.groups.queryType?.trim(), "Query type", warnings),
      errorNumber: canonicalText(
        errorMatch.groups.errorNumber,
        "Error number",
        warnings,
        CODE_LIMIT,
      ),
      errorMessage: canonicalText(errorMatch.groups.errorMessage, "Error message", warnings),
      outcome: "transport-error",
      warnings,
    };
  }

  const client = splitEndpoint(match.groups.client);
  const warnings = [...observation.warnings];
  const requestSizeBytes = Number(match.groups.requestSize);
  const ednsBufferSizeBytes = Number(match.groups.ednsBuffer);
  const responseSizeBytes = Number(match.groups.responseSize);
  const durationSeconds = Number(match.groups.duration);
  if (
    !Number.isFinite(requestSizeBytes) ||
    !Number.isFinite(ednsBufferSizeBytes) ||
    !Number.isFinite(responseSizeBytes) ||
    !Number.isFinite(durationSeconds)
  ) {
    return undefined;
  }
  const responseCode = canonicalText(
    match.groups.responseCode,
    "Response code",
    warnings,
    CODE_LIMIT,
  );
  return {
    ...observation,
    clientIp: canonicalText(client.ip, "Client IP", warnings, SHORT_TEXT_LIMIT),
    clientPort: canonicalText(client.port, "Client port", warnings, CODE_LIMIT),
    queryId: canonicalText(match.groups.queryId, "Query ID", warnings, SHORT_TEXT_LIMIT),
    queryType: canonicalText(match.groups.queryType, "Query type", warnings),
    queryClass: canonicalText(match.groups.queryClass, "Query class", warnings),
    queryName: canonicalText(match.groups.queryName, "Query name", warnings, QUERY_NAME_LIMIT),
    protocol: canonicalText(match.groups.protocol?.toUpperCase(), "Protocol", warnings, CODE_LIMIT),
    requestSizeBytes,
    dnssecOk: match.groups.dnssecOk?.toLowerCase() === "true",
    ednsBufferSizeBytes,
    responseCode,
    responseFlags: canonicalFlags(match.groups.flags, warnings),
    responseSizeBytes,
    durationSeconds,
    outcome: getOutcome(responseCode),
    warnings,
  };
}

function parseDnsFlowTrace(input: DnsRecordInput): DnsObservation {
  const { properties, record } = readRecord(input.raw);
  const observation = baseObservation(input, "dns-flow-trace", "dns-flow-trace");
  const warnings = [...observation.warnings];
  return {
    ...observation,
    clientIp: canonicalText(
      readText(record, properties, ["SourceIp"]),
      "Client IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    clientPort: canonicalText(
      readText(record, properties, ["SourcePort"]),
      "Client port",
      warnings,
      CODE_LIMIT,
    ),
    serverIp: canonicalText(
      readText(record, properties, ["ServerIp"]),
      "Server IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    serverPort: canonicalText(
      readText(record, properties, ["ServerPort"]),
      "Server port",
      warnings,
      CODE_LIMIT,
    ),
    msgType: canonicalText(
      readText(record, properties, ["MsgType"]),
      "Message type",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    queryMessage: canonicalText(
      readText(record, properties, ["QueryMessage"]),
      "Query message",
      warnings,
    ),
    serverMessage: canonicalText(
      readText(record, properties, ["ServerMessage"]),
      "Server message",
      warnings,
    ),
    queryTime: canonicalText(
      readText(record, properties, ["QueryTime"]),
      "Query time",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    responseTime: canonicalText(
      readText(record, properties, ["ResponseTime"]),
      "Response time",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    socketFamily: canonicalText(
      readText(record, properties, ["SocketFamily"]),
      "Socket family",
      warnings,
      CODE_LIMIT,
    ),
    outcome: "pending",
    parseState: "partial",
    warnings,
  };
}

function parseInternalFqdnFailure(input: DnsRecordInput): DnsObservation {
  const { properties, record } = readRecord(input.raw);
  const observation = baseObservation(input, "internal-fqdn-failure", "internal-resolution");
  const warnings = [...observation.warnings];
  const queryName = canonicalText(
    readText(record, properties, ["Fqdn"]),
    "FQDN",
    warnings,
    QUERY_NAME_LIMIT,
  );
  const errorMessage = canonicalText(
    readText(record, properties, ["Error"]),
    "Error message",
    warnings,
  );
  return {
    ...observation,
    queryName,
    serverIp: canonicalText(
      readText(record, properties, ["ServerIp"]),
      "Server IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    serverPort: canonicalText(
      readText(record, properties, ["ServerPort"]),
      "Server port",
      warnings,
      CODE_LIMIT,
    ),
    errorMessage,
    policy: canonicalText(input.policy, "Policy", warnings, SHORT_TEXT_LIMIT),
    ruleCollectionGroup: canonicalText(
      input.ruleCollectionGroup,
      "Rule collection group",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    ruleCollection: canonicalText(
      input.ruleCollection,
      "Rule collection",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    rule: canonicalText(input.rule, "Rule", warnings, SHORT_TEXT_LIMIT),
    outcome: "dns-error",
    parseState: queryName && errorMessage ? "parsed" : "partial",
    warnings,
  };
}

function parseStructured(input: DnsRecordInput): DnsObservation {
  const { properties, record } = readRecord(input.raw);
  const errorMessage = readText(record, properties, ["ErrorMessage"]);
  const sourceErrorNumber = readText(record, properties, ["ErrorNumber"]);
  const sourceResponseCode = readText(record, properties, ["ResponseCode"]);
  const flags = readText(record, properties, ["ResponseFlags"]);
  const observation = baseObservation(input, "proxy-structured", "proxy-exchange");
  const warnings = [...observation.warnings];
  const responseCode = canonicalText(sourceResponseCode, "Response code", warnings, CODE_LIMIT);
  const errorNumber = canonicalText(sourceErrorNumber, "Error number", warnings, CODE_LIMIT);
  const queryName = canonicalText(
    readText(record, properties, ["QueryName"]),
    "Query name",
    warnings,
    QUERY_NAME_LIMIT,
  );
  return {
    ...observation,
    clientIp: canonicalText(
      readText(record, properties, ["SourceIp", "ClientIp"]),
      "Client IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    clientPort: canonicalText(
      readText(record, properties, ["SourcePort", "ClientPort"]),
      "Client port",
      warnings,
      CODE_LIMIT,
    ),
    queryId: canonicalText(
      readText(record, properties, ["QueryId"]),
      "Query ID",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    queryName,
    queryType: canonicalText(readText(record, properties, ["QueryType"]), "Query type", warnings),
    queryClass: canonicalText(
      readText(record, properties, ["QueryClass"]),
      "Query class",
      warnings,
    ),
    protocol: canonicalText(
      readText(record, properties, ["Protocol"])?.toUpperCase(),
      "Protocol",
      warnings,
      CODE_LIMIT,
    ),
    requestSizeBytes: readNumber(record, properties, ["RequestSize"]),
    responseSizeBytes: readNumber(record, properties, ["ResponseSize"]),
    dnssecOk: readBoolean(record, properties, ["DnssecOkBit", "DnssecOk"]),
    ednsBufferSizeBytes: readNumber(record, properties, ["EDNS0BufferSize"]),
    responseCode,
    responseFlags: canonicalFlags(flags, warnings),
    durationSeconds: readNumber(record, properties, ["RequestDurationSecs"]),
    errorNumber,
    errorMessage: canonicalText(errorMessage, "Error message", warnings),
    outcome: getOutcome(responseCode, errorMessage, errorNumber),
    parseState: queryName ? "parsed" : "partial",
    warnings: queryName ? warnings : [...warnings, "Structured DNS query has no QueryName"],
  };
}

function parseNetwork(input: DnsRecordInput): DnsObservation | undefined {
  const protocol = input.protocol.toUpperCase();
  if (
    (protocol !== "TCP" && protocol !== "UDP") ||
    (input.sourcePort !== "53" && input.destinationPort !== "53")
  ) {
    return undefined;
  }
  const observation = baseObservation(input, "network-rule", "transport");
  const warnings = [...observation.warnings];
  const denied = input.action.toLowerCase().includes("deny");
  const sourceIsServer = input.sourcePort === "53" && input.destinationPort !== "53";
  const destinationIsServer = input.destinationPort === "53" && input.sourcePort !== "53";
  if (!sourceIsServer && !destinationIsServer) {
    warnings.push("DNS transport direction is ambiguous");
  }
  return {
    ...observation,
    action: canonicalText(input.action, "Action", warnings, SHORT_TEXT_LIMIT),
    clientIp: canonicalText(
      destinationIsServer ? input.sourceIp : sourceIsServer ? input.destinationIp : undefined,
      "Client IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    clientPort: canonicalText(
      destinationIsServer ? input.sourcePort : sourceIsServer ? input.destinationPort : undefined,
      "Client port",
      warnings,
      CODE_LIMIT,
    ),
    serverIp: canonicalText(
      destinationIsServer ? input.destinationIp : sourceIsServer ? input.sourceIp : undefined,
      "Server IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    serverPort: canonicalText(
      destinationIsServer ? input.destinationPort : sourceIsServer ? input.sourcePort : undefined,
      "Server port",
      warnings,
      CODE_LIMIT,
    ),
    networkSourceIp: canonicalText(input.sourceIp, "Source IP", warnings, SHORT_TEXT_LIMIT),
    networkSourcePort: canonicalText(input.sourcePort, "Source port", warnings, CODE_LIMIT),
    networkDestinationIp: canonicalText(
      input.destinationIp,
      "Destination IP",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    networkDestinationPort: canonicalText(
      input.destinationPort,
      "Destination port",
      warnings,
      CODE_LIMIT,
    ),
    policy: canonicalText(input.policy, "Policy", warnings, SHORT_TEXT_LIMIT),
    ruleCollectionGroup: canonicalText(
      input.ruleCollectionGroup,
      "Rule collection group",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    ruleCollection: canonicalText(
      input.ruleCollection,
      "Rule collection",
      warnings,
      SHORT_TEXT_LIMIT,
    ),
    rule: canonicalText(input.rule, "Rule", warnings, SHORT_TEXT_LIMIT),
    protocol,
    outcome: denied ? "blocked" : "transport-observed",
    warnings,
  };
}

export function parseDnsObservation(input: DnsRecordInput): DnsObservation | undefined {
  const category = input.category.toLowerCase();
  if (category === "azurefirewalldnsproxy") {
    return input.origin === "event-hub" ? parseDnsProxyMessage(input) : undefined;
  }
  if (category === "azfwdnsquery")
    return input.origin === "log-analytics" ? parseStructured(input) : undefined;
  if (category === "azfwdnsflowtrace")
    return input.origin === "log-analytics" ? parseDnsFlowTrace(input) : undefined;
  if (category === "azfwinternalfqdnresolutionfailure")
    return input.origin === "log-analytics" ? parseInternalFqdnFailure(input) : undefined;
  if (category === "azfwnetworkrule" || category === "azurefirewallnetworkrule") {
    return parseNetwork(input);
  }
  return undefined;
}

export function createDnsDetailSelector(
  observation: DnsObservation,
): DnsDetailSelector | undefined {
  if (!observation.resourceId) return undefined;
  if (observation.source === "dns-proxy") return undefined;
  if (observation.source === "network-rule") {
    if (
      !observation.protocol ||
      !observation.networkSourceIp ||
      !observation.networkSourcePort ||
      !observation.networkDestinationIp ||
      !observation.networkDestinationPort
    ) {
      return undefined;
    }
    return {
      source: observation.source,
      resourceId: observation.resourceId,
      timestamp: observation.timestamp,
      protocol: observation.protocol,
      networkSourceIp: observation.networkSourceIp,
      networkSourcePort: observation.networkSourcePort,
      networkDestinationIp: observation.networkDestinationIp,
      networkDestinationPort: observation.networkDestinationPort,
    };
  }
  if (observation.source === "dns-flow-trace") {
    return {
      source: observation.source,
      resourceId: observation.resourceId,
      timestamp: observation.timestamp,
      msgType: observation.msgType,
      queryMessage: observation.queryMessage,
      serverMessage: observation.serverMessage,
      queryTime: observation.queryTime,
      responseTime: observation.responseTime,
      socketFamily: observation.socketFamily,
      clientIp: observation.clientIp,
      clientPort: observation.clientPort,
      serverIp: observation.serverIp,
      serverPort: observation.serverPort,
    };
  }
  if (observation.source === "internal-fqdn-failure") {
    return {
      source: observation.source,
      resourceId: observation.resourceId,
      timestamp: observation.timestamp,
      queryName: observation.queryName,
      serverIp: observation.serverIp,
      serverPort: observation.serverPort,
      errorMessage: observation.errorMessage,
      policy: observation.policy,
      ruleCollectionGroup: observation.ruleCollectionGroup,
      ruleCollection: observation.ruleCollection,
      rule: observation.rule,
    };
  }
  return {
    source: observation.source,
    resourceId: observation.resourceId,
    timestamp: observation.timestamp,
    queryId: observation.queryId,
    queryName: observation.queryName,
    clientIp: observation.clientIp,
    clientPort: observation.clientPort,
  };
}

export function createDnsEntries(observations: readonly DnsObservation[]): DnsEntry[] {
  return observations
    .filter((observation) => observation.source !== "network-rule")
    .map<DnsEntry>((observation) => ({
      id: observation.id,
      timestamp: observation.timestamp,
      displayText: observation.queryName ?? observation.queryMessage ?? observation.msgType,
      queryName: observation.queryName,
      queryType: observation.queryType,
      client: [observation.clientIp, observation.clientPort].filter(Boolean).join(":"),
      destination: [observation.serverIp, observation.serverPort].filter(Boolean).join(":"),
      protocol: observation.protocol,
      path: observation.path,
      outcome: observation.outcome,
      durationSeconds: observation.durationSeconds,
      observationCount: 1,
      completeness: observation.stage === "proxy-exchange" ? "complete" : "partial",
      confidence: "uncorrelated",
      source: observation.source,
      warnings: [...observation.warnings],
      observations: [observation],
      detailSelector: createDnsDetailSelector(observation),
    }))
    .toSorted((left, right) => {
      const timestampOrder = right.timestamp.localeCompare(left.timestamp);
      return timestampOrder || right.id.localeCompare(left.id);
    });
}

export const DNS_QUERY_TYPE_LABELS: Readonly<Record<string, string>> = {
  A: "IPv4 address",
  AAAA: "IPv6 address",
  CNAME: "Canonical name",
  HTTPS: "HTTPS service binding",
  MX: "Mail exchange",
  PTR: "Reverse lookup",
  SRV: "Service location",
  TXT: "Text record",
};

export const DNS_FLAG_LABELS: Readonly<Record<string, string>> = {
  aa: "Authoritative answer",
  ad: "Authenticated data",
  cd: "Checking disabled",
  qr: "Response",
  ra: "Recursion available",
  rd: "Recursion desired",
  tc: "Truncated response",
};

export const DNS_CLASS_LABELS: Readonly<Record<string, string>> = {
  IN: "Internet",
};

export const DNS_RCODE_LABELS: Readonly<Record<string, string>> = {
  FORMERR: "Format error",
  NOERROR: "No protocol error",
  NOTIMP: "Not implemented",
  NXDOMAIN: "Name does not exist",
  REFUSED: "Query refused",
  SERVFAIL: "Server failure",
};
