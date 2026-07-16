import type { FirewallLogRecord } from "~/types/firewall";

export const NETWORK_RULE_CORRELATION_WINDOW_MS = 250;
const ICMP_PROTOCOL_PATTERN = /^ICMP(?:\s|$)/;

type NetworkRuleSchema = "legacy" | "structured";

interface CorrelationCandidate {
  expiresAt: number;
  key: string;
  record?: FirewallLogRecord;
  schema: NetworkRuleSchema;
}

interface CandidateBucket {
  legacy: Set<CorrelationCandidate>;
  structured: Set<CorrelationCandidate>;
}

export interface NetworkRuleCorrelationScheduler {
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout>;
}

interface NetworkRuleCorrelatorOptions {
  clock?: () => number;
  maxCandidates: () => number;
  onRecords: (records: readonly FirewallLogRecord[]) => void;
  scheduler?: NetworkRuleCorrelationScheduler;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNetworkRuleSchema(category: string): NetworkRuleSchema | undefined {
  const normalized = category.trim().toLowerCase();
  if (normalized === "azfwnetworkrule") return "structured";
  if (normalized === "azurefirewallnetworkrule") return "legacy";
  return undefined;
}

function readExactSourceTimestamp(raw: unknown) {
  if (!isRecord(raw)) return undefined;

  const properties = isRecord(raw.properties) ? raw.properties : undefined;
  const sources = properties ? [raw, properties] : [raw];
  for (const source of sources) {
    for (const key of ["time", "TimeGenerated", "timestamp"] as const) {
      const value = source[key];
      if (typeof value !== "string" || value.trim().length === 0) continue;

      const timestamp = value.trim();
      return Number.isNaN(Date.parse(timestamp)) ? undefined : timestamp;
    }
  }

  return undefined;
}

function normalizeRequired(value: string | undefined, casing: "lower" | "upper") {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return casing === "lower" ? normalized.toLowerCase() : normalized.toUpperCase();
}

function normalizeProtocol(protocol: string) {
  const normalized = normalizeRequired(protocol, "upper");
  if (!normalized || normalized === "UNKNOWN") return undefined;
  return ICMP_PROTOCOL_PATTERN.test(normalized) ? "ICMP" : normalized;
}

export function getNetworkRuleCorrelationKey(record: FirewallLogRecord) {
  if (!getNetworkRuleSchema(record.category)) return undefined;

  const timestamp = readExactSourceTimestamp(record.raw);
  const resourceId = normalizeRequired(record.resourceId, "lower");
  const protocol = normalizeProtocol(record.protocol);
  const action = normalizeRequired(record.action, "upper");
  const sourceIp = normalizeRequired(record.sourceIp, "lower");
  const sourcePort = record.sourcePort?.trim();
  const destinationIp = normalizeRequired(record.destinationIp, "lower");
  const destinationPort = record.destinationPort?.trim();

  if (
    !timestamp ||
    !resourceId ||
    !protocol ||
    !action ||
    action === "UNKNOWN" ||
    !sourceIp ||
    !sourcePort ||
    !destinationIp ||
    !destinationPort
  ) {
    return undefined;
  }

  return JSON.stringify([
    "network-rule",
    timestamp,
    resourceId,
    protocol,
    action,
    sourceIp,
    sourcePort,
    destinationIp,
    destinationPort,
  ]);
}

function firstValue<T>(values: Set<T>) {
  return values.values().next().value;
}

function normalizeCandidateLimit(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

const defaultScheduler: NetworkRuleCorrelationScheduler = {
  clearTimeout: (handle) => clearTimeout(handle),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
};

export function createNetworkRuleCorrelator({
  clock = Date.now,
  maxCandidates,
  onRecords,
  scheduler = defaultScheduler,
}: NetworkRuleCorrelatorOptions) {
  const buckets = new Map<string, CandidateBucket>();
  const candidates = new Set<CorrelationCandidate>();
  let lastNow = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timerExpiresAt: number | undefined;
  let timerGeneration = 0;

  function readNow() {
    const value = clock();
    if (!Number.isFinite(value)) return lastNow === Number.NEGATIVE_INFINITY ? 0 : lastNow;
    lastNow = Math.max(lastNow, value);
    return lastNow;
  }

  function getBucket(key: string) {
    const existing = buckets.get(key);
    if (existing) return existing;

    const bucket: CandidateBucket = { legacy: new Set(), structured: new Set() };
    buckets.set(key, bucket);
    return bucket;
  }

  function removeCandidate(candidate: CorrelationCandidate) {
    candidates.delete(candidate);
    const bucket = buckets.get(candidate.key);
    if (!bucket) return;

    bucket[candidate.schema].delete(candidate);
    if (bucket.legacy.size === 0 && bucket.structured.size === 0) {
      buckets.delete(candidate.key);
    }
  }

  function takeCandidate(key: string, schema: NetworkRuleSchema) {
    const bucket = buckets.get(key);
    if (!bucket) return undefined;
    const candidate = firstValue(bucket[schema]);
    if (candidate) removeCandidate(candidate);
    return candidate;
  }

  function addCandidate(
    key: string,
    schema: NetworkRuleSchema,
    expiresAt: number,
    record?: FirewallLogRecord,
  ) {
    const candidate: CorrelationCandidate = { expiresAt, key, record, schema };
    candidates.add(candidate);
    getBucket(key)[schema].add(candidate);
  }

  function drainExpired(now: number, accepted: FirewallLogRecord[]) {
    for (const candidate of candidates) {
      if (candidate.expiresAt > now) break;
      removeCandidate(candidate);
      if (candidate.schema === "legacy" && candidate.record) accepted.push(candidate.record);
    }
  }

  function enforceCapacity(maximum: number, accepted: FirewallLogRecord[]) {
    while (candidates.size > maximum) {
      const candidate = firstValue(candidates);
      if (!candidate) break;
      removeCandidate(candidate);
      if (candidate.schema === "legacy" && candidate.record) accepted.push(candidate.record);
    }
  }

  function cancelTimer() {
    timerGeneration += 1;
    if (timer !== undefined) scheduler.clearTimeout(timer);
    timer = undefined;
    timerExpiresAt = undefined;
  }

  function emit(records: FirewallLogRecord[]) {
    if (records.length > 0) onRecords(records);
  }

  function scheduleTimer() {
    const candidate = firstValue(candidates);
    if (!candidate) {
      cancelTimer();
      return;
    }
    if (timer !== undefined && timerExpiresAt === candidate.expiresAt) return;

    cancelTimer();
    const generation = timerGeneration;
    timerExpiresAt = candidate.expiresAt;
    timer = scheduler.setTimeout(
      () => {
        if (generation !== timerGeneration) return;
        timer = undefined;
        timerExpiresAt = undefined;
        const accepted: FirewallLogRecord[] = [];
        drainExpired(readNow(), accepted);
        scheduleTimer();
        emit(accepted);
      },
      Math.max(0, candidate.expiresAt - readNow()),
    );
  }

  function push(records: readonly FirewallLogRecord[]) {
    if (records.length === 0) return;

    const accepted: FirewallLogRecord[] = [];
    const arrivalTime = readNow();
    const maximum = normalizeCandidateLimit(maxCandidates());
    drainExpired(arrivalTime, accepted);
    enforceCapacity(maximum, accepted);

    for (const record of records) {
      const schema = getNetworkRuleSchema(record.category);
      const key = schema ? getNetworkRuleCorrelationKey(record) : undefined;
      if (!schema || !key) {
        accepted.push(record);
        continue;
      }

      if (schema === "structured") {
        const legacy = takeCandidate(key, "legacy");
        accepted.push(record);
        if (!legacy) {
          addCandidate(key, schema, arrivalTime + NETWORK_RULE_CORRELATION_WINDOW_MS);
          enforceCapacity(maximum, accepted);
        }
        continue;
      }

      const structured = takeCandidate(key, "structured");
      if (!structured) {
        addCandidate(key, schema, arrivalTime + NETWORK_RULE_CORRELATION_WINDOW_MS, record);
        enforceCapacity(maximum, accepted);
      }
    }

    scheduleTimer();
    emit(accepted);
  }

  function flush() {
    cancelTimer();
    const accepted: FirewallLogRecord[] = [];
    for (const candidate of candidates) {
      if (candidate.schema === "legacy" && candidate.record) accepted.push(candidate.record);
    }
    candidates.clear();
    buckets.clear();
    emit(accepted);
  }

  function clear() {
    cancelTimer();
    candidates.clear();
    buckets.clear();
  }

  return { clear, flush, push };
}
