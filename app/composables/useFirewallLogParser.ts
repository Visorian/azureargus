import type { FirewallLogRecord } from "~/types/firewall";
import { parseDnsObservation } from "#shared/utils/dns";

export interface FirewallLogInput {
  raw: unknown;
  enqueuedTimeUtc?: Date | string;
  partitionId?: string;
  sequenceNumber?: number | string;
  offset?: number | string;
  index?: number;
  eventRecordIndex?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(source: Record<string, unknown> | null, keys: string[]) {
  if (source === null) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (typeof value === "number") {
      return String(value);
    }
  }

  return undefined;
}

function normalizeTimestamp(value: string | Date | undefined) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return new Date(0).toISOString();
}

function extractActionFallback(message: string, category: string) {
  const normalizedCategory = category.toLowerCase();
  if (
    normalizedCategory === "azfwdnsquery" ||
    (normalizedCategory === "azurefirewalldnsproxy" && /^\s*DNS Request\s*:/i.test(message))
  ) {
    return "DNS query";
  }

  const actionMatch = message.match(/\b(action|decision)\s*[:=]\s*(allow|deny|dnat|snat)\b/i);
  if (actionMatch?.[2]) {
    return actionMatch[2].toUpperCase();
  }

  const keywordMatch = message.match(/\b(allow|allowed|deny|denied|dnat|snat)\b/i);
  if (!keywordMatch?.[1]) {
    return "Unknown";
  }

  const value = keywordMatch[1].toLowerCase();
  if (value === "allowed") {
    return "ALLOW";
  }
  if (value === "denied") {
    return "DENY";
  }

  return value.toUpperCase();
}

function extractLegacyProtocol(message: string) {
  const explicitMatch = message.match(/\bprotocol\s*[:=]\s*([a-z0-9-]+)\b/i);
  if (explicitMatch?.[1]) {
    return explicitMatch[1].toUpperCase();
  }

  const keywordMatch = message.match(/\b(tcp|udp|icmp|http|https)\b/i);
  return keywordMatch?.[1]?.toUpperCase() ?? "Unknown";
}

function extractLegacyPolicy(message: string) {
  return message
    .match(
      /\bPolicy\s*:\s*(.*?)(?=\.\s*(?:Rule Collection Group|Rule Collection|Rule)\s*:|$)/i,
    )?.[1]
    ?.trim();
}

function extractLegacyRuleCollectionGroup(message: string) {
  return message
    .match(/\bRule Collection Group\s*:\s*(.*?)(?=\.\s*(?:Rule Collection|Rule)\s*:|$)/i)?.[1]
    ?.trim();
}

function extractIpPorts(message: string) {
  const matches = [
    ...message.matchAll(/\b(?<ip>(?:\d{1,3}\.){3}\d{1,3})(?::(?<port>\d{1,5}))?\b/g),
  ];
  const first = matches[0]?.groups;
  const second = matches[1]?.groups;

  return {
    sourceIp: first?.ip,
    sourcePort: first?.port,
    destinationIp: second?.ip,
    destinationPort: second?.port,
  };
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export function expandAzureMonitorRecords(body: unknown): unknown[] {
  if (Array.isArray(body)) {
    return body;
  }

  if (isRecord(body) && Array.isArray(body.records)) {
    return body.records;
  }

  return [body];
}

export function normalizeFirewallLogRecord(input: FirewallLogInput): FirewallLogRecord {
  const rawRecord = isRecord(input.raw) ? input.raw : null;
  const properties = rawRecord && isRecord(rawRecord.properties) ? rawRecord.properties : null;
  const message =
    readString(properties, ["msg", "message", "Message"]) ||
    readString(rawRecord, ["msg", "message", "Message"]) ||
    safeJson(input.raw);

  const legacyAddressParts = extractIpPorts(message);
  const timestamp = normalizeTimestamp(
    readString(rawRecord, ["time", "TimeGenerated", "timestamp"]) ||
      readString(properties, ["time", "TimeGenerated", "timestamp"]) ||
      input.enqueuedTimeUtc,
  );
  const category =
    readString(rawRecord, ["category", "Category"]) ||
    readString(properties, ["category", "Category"]) ||
    "Unknown";
  const action =
    readString(properties, ["action", "Action"]) ||
    readString(rawRecord, ["action", "Action"]) ||
    extractActionFallback(message, category);
  const protocol =
    readString(properties, ["protocol", "Protocol"]) ||
    readString(rawRecord, ["protocol", "Protocol"]) ||
    extractLegacyProtocol(message);
  const sourceIp =
    readString(properties, ["sourceIp", "sourceIP", "SourceIp", "SourceIP"]) ||
    readString(rawRecord, ["sourceIp", "sourceIP", "SourceIp", "SourceIP"]) ||
    legacyAddressParts.sourceIp;
  const destinationIp =
    readString(properties, ["destinationIp", "destinationIP", "DestinationIp", "DestinationIP"]) ||
    readString(rawRecord, ["destinationIp", "destinationIP", "DestinationIp", "DestinationIP"]) ||
    legacyAddressParts.destinationIp;
  const sourcePort =
    readString(properties, ["sourcePort", "SourcePort"]) ||
    readString(rawRecord, ["sourcePort", "SourcePort"]) ||
    legacyAddressParts.sourcePort;
  const destinationPort =
    readString(properties, ["destinationPort", "DestinationPort"]) ||
    readString(rawRecord, ["destinationPort", "DestinationPort"]) ||
    legacyAddressParts.destinationPort;
  const policy =
    readString(properties, ["policy", "Policy", "policyName"]) ||
    readString(rawRecord, ["policy", "Policy", "policyName"]) ||
    extractLegacyPolicy(message);
  const ruleCollectionGroup =
    readString(properties, [
      "ruleCollectionGroup",
      "RuleCollectionGroup",
      "ruleCollectionGroupName",
    ]) ||
    readString(rawRecord, [
      "ruleCollectionGroup",
      "RuleCollectionGroup",
      "ruleCollectionGroupName",
    ]) ||
    extractLegacyRuleCollectionGroup(message);
  const ruleCollection =
    readString(properties, ["ruleCollection", "RuleCollection", "ruleCollectionName"]) ||
    readString(rawRecord, ["ruleCollection", "RuleCollection", "ruleCollectionName"]);
  const explicitRule =
    readString(properties, ["rule", "Rule", "ruleName"]) ||
    readString(rawRecord, ["rule", "Rule", "ruleName"]);
  const actionReason =
    readString(properties, ["actionReason", "ActionReason"]) ||
    readString(rawRecord, ["actionReason", "ActionReason"]);
  const rule =
    explicitRule ??
    (category === "AZFWNetworkRule" && actionReason === "Default Action" ? "Default" : undefined);
  const sequenceNumber =
    input.sequenceNumber === undefined ? undefined : String(input.sequenceNumber);
  const offset = input.offset === undefined ? undefined : String(input.offset);
  const enqueuedTimeUtc =
    input.enqueuedTimeUtc === undefined ? undefined : normalizeTimestamp(input.enqueuedTimeUtc);
  const eventRecordIndex = input.eventRecordIndex ?? input.index ?? 0;
  const resourceId =
    readString(rawRecord, ["resourceId", "ResourceId", "_ResourceId"]) ||
    readString(properties, ["resourceId", "ResourceId", "_ResourceId"]);
  const id = [
    input.partitionId ?? "partition",
    offset ?? sequenceNumber ?? `index-${input.index ?? 0}`,
    eventRecordIndex,
    timestamp,
    resourceId?.toLowerCase() ?? "resource",
    category.toLowerCase(),
  ].join(":");
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

  return {
    id,
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
    resourceId,
    message,
    raw: input.raw,
    partitionId: input.partitionId,
    sequenceNumber,
    offset,
    eventRecordIndex,
    enqueuedTimeUtc,
    dns: parseDnsObservation({
      id,
      timestamp,
      category,
      action,
      protocol,
      sourceIp,
      sourcePort,
      destinationIp,
      destinationPort,
      resourceId,
      message,
      raw: input.raw,
      origin: "event-hub",
    }),
    searchableText,
  };
}
