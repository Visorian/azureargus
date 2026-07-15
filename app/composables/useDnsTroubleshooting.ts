import type {
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsEntry,
  DnsFilterOptions,
  DnsFilters,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsObservation,
  DnsSort,
} from "#shared/types/dns";
import type { LogAnalyticsStorageKind } from "#shared/types/logAnalytics";
import { createDnsDetailSelector, DNS_QUERY_TYPE_LABELS } from "#shared/utils/dns";
import { computed, onScopeDispose, reactive, ref, shallowRef, watch, type Ref } from "vue";
import { createDnsObservationStore } from "~/utils/dnsObservationStore";
import { parseLogAnalysisDateRange, type LogAnalysisDateRange } from "~/utils/logAnalysis";
import type { AnalysisMode } from "./useAnalysisMode";
import { DEFAULT_LOG_UI_PUBLISH_INTERVAL_MS } from "./useBoundedLogBuffer";
import type { NormalizedLogBatchSink } from "./useEventHubReceiver";

type DnsRequestStatus = "idle" | "loading" | "success" | "error";
type ListRequest = (
  body: DnsListQueryRequest,
  signal: AbortSignal,
) => Promise<DnsListQueryResponse>;
type DetailRequest = (
  body: DnsDetailQueryRequest,
  signal: AbortSignal,
) => Promise<DnsDetailQueryResponse>;

interface DnsReceiverSource {
  addNormalizedBatchSink(sink: NormalizedLogBatchSink): () => boolean;
}

interface UseDnsTroubleshootingOptions {
  active: Readonly<Ref<boolean>>;
  draftRange: LogAnalysisDateRange;
  mode: Readonly<Ref<AnalysisMode>>;
  queryLimit: Readonly<Ref<number>>;
  receiver: DnsReceiverSource;
  requestDetail: DetailRequest;
  requestList: ListRequest;
  storage: Readonly<Ref<LogAnalyticsStorageKind>>;
}

function defaultFilters(): DnsFilters {
  return { search: "", queryType: "", client: "", protocol: "", outcome: "", source: "" };
}

function defaultSort(): DnsSort {
  return { key: "timestamp", direction: "desc" };
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

function errorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data;
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
  }
  return error instanceof Error ? error.message : "DNS query failed.";
}

function includes(value: string | undefined, search: string) {
  return !search || value?.toLowerCase().includes(search.toLowerCase()) === true;
}

function equals(value: string | undefined, expected: string) {
  return !expected || value?.trim().toLowerCase() === expected.trim().toLowerCase();
}

function matchesEntry(entry: DnsEntry, filters: DnsFilters) {
  const search = filters.search.trim().toLowerCase();
  const searchable = [
    entry.queryName,
    entry.displayText,
    entry.queryType,
    entry.client,
    entry.protocol,
    entry.outcome,
    entry.source,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    (!search || searchable.includes(search)) &&
    equals(entry.queryType, filters.queryType) &&
    includes(entry.client, filters.client.trim()) &&
    equals(entry.protocol, filters.protocol) &&
    equals(entry.outcome, filters.outcome) &&
    equals(entry.source, filters.source)
  );
}

function matchesTransport(observation: DnsObservation, filters: DnsFilters) {
  const search = filters.search.trim().toLowerCase();
  const searchable = [
    observation.clientIp,
    observation.clientPort,
    observation.serverIp,
    observation.serverPort,
    observation.protocol,
    observation.action,
    observation.policy,
    observation.ruleCollectionGroup,
    observation.ruleCollection,
    observation.rule,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return (
    (!search || searchable.includes(search)) &&
    equals(observation.queryType, filters.queryType) &&
    includes(observation.clientIp, filters.client.trim()) &&
    equals(observation.protocol, filters.protocol) &&
    equals(observation.outcome, filters.outcome) &&
    equals(observation.source, filters.source)
  );
}

function compareEntries(left: DnsEntry, right: DnsEntry, sort: DnsSort) {
  let result: number;
  if (sort.key === "timestamp") result = left.timestamp.localeCompare(right.timestamp);
  else if (sort.key === "duration")
    result = (left.durationSeconds ?? -1) - (right.durationSeconds ?? -1);
  else if (sort.key === "observations") result = left.observationCount - right.observationCount;
  else
    result = (left.displayText ?? left.queryName ?? "").localeCompare(
      right.displayText ?? right.queryName ?? "",
    );
  if (result === 0) result = left.id.localeCompare(right.id);
  return sort.direction === "asc" ? result : -result;
}

function transportEntry(observation: DnsObservation): DnsEntry {
  return {
    id: observation.id,
    timestamp: observation.timestamp,
    client: [observation.clientIp, observation.clientPort].filter(Boolean).join(":"),
    destination: [observation.serverIp, observation.serverPort].filter(Boolean).join(":"),
    protocol: observation.protocol,
    path: observation.path,
    outcome: observation.outcome,
    observationCount: 1,
    completeness: "partial",
    confidence: "uncorrelated",
    source: observation.source,
    warnings: [...observation.warnings],
    observations: [observation],
    detailSelector: createDnsDetailSelector(observation),
  };
}

function hasActiveFilters(filters: DnsFilters) {
  return Object.values(filters).some((value) => value.trim().length > 0);
}

function sortedOptions<T extends string>(values: readonly (T | undefined)[]) {
  return [...new Set(values.filter((value): value is T => Boolean(value)))]
    .filter((value) => value.length > 0)
    .toSorted((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function useDnsTroubleshooting(options: UseDnsTroubleshootingOptions) {
  const realtimeFilters = reactive(defaultFilters());
  const logFilters = reactive(defaultFilters());
  const realtimeSort = reactive(defaultSort());
  const logSort = reactive(defaultSort());
  const realtimeShowUnidentifiedTransports = ref(false);
  const logShowUnidentifiedTransports = ref(false);
  const filters = computed(() =>
    options.mode.value === "log-analysis" ? logFilters : realtimeFilters,
  );
  const sort = computed(() => (options.mode.value === "log-analysis" ? logSort : realtimeSort));
  const showUnidentifiedTransports = computed({
    get: () =>
      options.mode.value === "log-analysis"
        ? logShowUnidentifiedTransports.value
        : realtimeShowUnidentifiedTransports.value,
    set: (value: boolean) => {
      if (options.mode.value === "log-analysis") {
        logShowUnidentifiedTransports.value = value;
      } else {
        realtimeShowUnidentifiedTransports.value = value;
      }
    },
  });
  const realtimeEntries = shallowRef<DnsEntry[]>([]);
  const realtimeTransports = shallowRef<DnsObservation[]>([]);
  const logResponse = shallowRef<DnsListQueryResponse | null>(null);
  const appliedRange = ref<{ from: string; to: string } | null>(null);
  const logStatus = ref<DnsRequestStatus>("idle");
  const logLastError = ref<string | null>(null);
  const realtimeEntriesTruncated = ref(false);
  const realtimeTransportsTruncated = ref(false);
  const rangeError = ref<string | null>(null);
  const selectedEntry = ref<DnsEntry | null>(null);
  const detail = shallowRef<DnsDetailQueryResponse | null>(null);
  const detailStatus = ref<DnsRequestStatus>("idle");
  const detailError = ref<string | null>(null);
  const store = createDnsObservationStore();
  let listController: AbortController | null = null;
  let detailController: AbortController | null = null;
  let listGeneration = 0;
  let detailGeneration = 0;
  let realtimePublishTimer: ReturnType<typeof setTimeout> | null = null;
  let realtimeDirty = false;

  function cancelRealtimePublish() {
    if (realtimePublishTimer === null) return;
    clearTimeout(realtimePublishTimer);
    realtimePublishTimer = null;
  }

  function publishRealtimeSnapshot() {
    cancelRealtimePublish();
    if (!options.active.value || options.mode.value !== "real-time-analysis") return;
    const snapshot = store.snapshot();
    realtimeEntries.value = snapshot.entries;
    realtimeTransports.value = snapshot.transports;
    realtimeDirty = false;
  }

  function scheduleRealtimePublish(delayMs = 0) {
    if (!realtimeDirty || realtimePublishTimer !== null) return;
    realtimePublishTimer = setTimeout(publishRealtimeSnapshot, delayMs);
  }

  const removeSink = options.receiver.addNormalizedBatchSink({
    onRecords(records) {
      const result = store.pushRecords(records);
      realtimeDirty = true;
      if (result.evictedEntryIds.length > 0) realtimeEntriesTruncated.value = true;
      if (result.evictedTransportIds.length > 0) realtimeTransportsTruncated.value = true;
      if (options.active.value && options.mode.value === "real-time-analysis") {
        scheduleRealtimePublish(DEFAULT_LOG_UI_PUBLISH_INTERVAL_MS);
      }
    },
    onClear() {
      store.clear();
      realtimeDirty = true;
      realtimeEntriesTruncated.value = false;
      realtimeTransportsTruncated.value = false;
      if (options.active.value && options.mode.value === "real-time-analysis") {
        publishRealtimeSnapshot();
      }
    },
  });

  const entries = computed(() =>
    options.mode.value === "log-analysis"
      ? (logResponse.value?.queriedEntries ?? [])
      : realtimeEntries.value,
  );
  const transports = computed(() =>
    options.mode.value === "log-analysis"
      ? (logResponse.value?.transportObservations ?? [])
      : realtimeTransports.value,
  );
  const filteredNamedEntries = computed(() => {
    const currentEntries = entries.value;
    const filtered = hasActiveFilters(filters.value)
      ? currentEntries.filter((entry) => matchesEntry(entry, filters.value))
      : currentEntries;
    if (sort.value.key === "timestamp" && sort.value.direction === "desc") return filtered;
    return filtered.toSorted((left, right) => compareEntries(left, right, sort.value));
  });
  const filteredTransports = computed(() =>
    hasActiveFilters(filters.value)
      ? transports.value.filter((observation) => matchesTransport(observation, filters.value))
      : transports.value,
  );
  const filteredEntries = computed(() => {
    if (!showUnidentifiedTransports.value) return filteredNamedEntries.value;
    return [
      ...filteredNamedEntries.value,
      ...filteredTransports.value.map((observation) => transportEntry(observation)),
    ].toSorted((left, right) => compareEntries(left, right, sort.value));
  });
  const filterOptions = computed<DnsFilterOptions>(() => ({
    outcomes: sortedOptions([
      ...entries.value.map((entry) => entry.outcome),
      ...transports.value.map((observation) => observation.outcome),
    ]),
    protocols: sortedOptions([
      "TCP",
      "UDP",
      ...entries.value.map((entry) => entry.protocol),
      ...transports.value.map((observation) => observation.protocol),
    ]),
    queryTypes: sortedOptions([
      ...Object.keys(DNS_QUERY_TYPE_LABELS),
      ...entries.value.map((entry) => entry.queryType),
    ]),
    sources: sortedOptions([
      ...entries.value.map((entry) => entry.source),
      ...transports.value.map((observation) => observation.source),
    ]),
  }));
  const entriesTruncated = computed(() =>
    options.mode.value === "log-analysis"
      ? logResponse.value?.queriedEntriesTruncated === true
      : realtimeEntriesTruncated.value,
  );
  const transportsTruncated = computed(() =>
    options.mode.value === "log-analysis"
      ? logResponse.value?.transportObservationsTruncated === true
      : realtimeTransportsTruncated.value,
  );
  const truncated = computed(() => entriesTruncated.value || transportsTruncated.value);
  const status = computed<DnsRequestStatus>(() =>
    options.mode.value === "log-analysis" ? logStatus.value : "idle",
  );
  const lastError = computed(() =>
    options.mode.value === "log-analysis" ? logLastError.value : null,
  );
  const rangeDirty = computed(() => {
    if (!appliedRange.value) return false;
    const parsed = parseLogAnalysisDateRange(options.draftRange);
    return (
      !parsed.ok ||
      parsed.value.from !== appliedRange.value.from ||
      parsed.value.to !== appliedRange.value.to
    );
  });
  const canApplyFilters = computed(
    () =>
      options.mode.value === "log-analysis" &&
      appliedRange.value !== null &&
      !rangeDirty.value &&
      logStatus.value !== "loading",
  );

  function abortList() {
    listGeneration += 1;
    listController?.abort();
    listController = null;
    if (logStatus.value === "loading") logStatus.value = logResponse.value ? "success" : "idle";
  }

  function abortDetail() {
    detailGeneration += 1;
    detailController?.abort();
    detailController = null;
    if (detailStatus.value === "loading") detailStatus.value = detail.value ? "success" : "idle";
  }

  function abort() {
    abortList();
    abortDetail();
  }

  async function executeList(range: { from: string; to: string }) {
    abortList();
    const controller = new AbortController();
    const generation = ++listGeneration;
    listController = controller;
    logStatus.value = "loading";
    logLastError.value = null;
    try {
      const response = await options.requestList(
        {
          from: range.from,
          to: range.to,
          filters: { ...filters.value },
          limit: options.queryLimit.value,
          storage: options.storage.value,
        },
        controller.signal,
      );
      if (
        generation !== listGeneration ||
        !options.active.value ||
        options.mode.value !== "log-analysis"
      ) {
        return false;
      }
      closeDetail();
      logResponse.value = response;
      appliedRange.value = range;
      logStatus.value = "success";
      return true;
    } catch (error: unknown) {
      if (generation !== listGeneration || isAbortError(error)) return false;
      logLastError.value = errorMessage(error);
      logStatus.value = logResponse.value ? "success" : "error";
      return false;
    } finally {
      if (generation === listGeneration) listController = null;
    }
  }

  async function run() {
    if (options.mode.value !== "log-analysis") return false;
    const parsed = parseLogAnalysisDateRange(options.draftRange);
    if (!parsed.ok) {
      rangeError.value = parsed.error;
      return false;
    }
    rangeError.value = null;
    return executeList(parsed.value);
  }

  async function applyFilters() {
    if (options.mode.value !== "log-analysis" || !appliedRange.value || rangeDirty.value)
      return false;
    return executeList(appliedRange.value);
  }

  async function selectEntry(entry: DnsEntry) {
    abortDetail();
    selectedEntry.value = entry;
    detailError.value = null;
    if (options.mode.value !== "log-analysis" || !entry.detailSelector) {
      detail.value = {
        observations: entry.observations,
        detailTruncated: false,
        completeness: entry.completeness,
        warnings: entry.warnings,
      };
      detailStatus.value = "success";
      return true;
    }
    detail.value = null;
    const controller = new AbortController();
    const generation = ++detailGeneration;
    detailController = controller;
    detailStatus.value = "loading";
    try {
      const response = await options.requestDetail(
        { selector: entry.detailSelector },
        controller.signal,
      );
      if (generation !== detailGeneration || !options.active.value) return false;
      detail.value = response;
      detailStatus.value = "success";
      return true;
    } catch (error: unknown) {
      if (generation !== detailGeneration || isAbortError(error)) return false;
      detailError.value = errorMessage(error);
      detailStatus.value = "error";
      return false;
    } finally {
      if (generation === detailGeneration) detailController = null;
    }
  }

  function closeDetail() {
    abortDetail();
    selectedEntry.value = null;
    detail.value = null;
    detailStatus.value = "idle";
    detailError.value = null;
  }

  function resetFilters() {
    Object.assign(filters.value, defaultFilters());
    showUnidentifiedTransports.value = false;
  }

  function clearActiveDataset() {
    closeDetail();
    if (options.mode.value === "log-analysis") {
      abortList();
      logResponse.value = null;
      appliedRange.value = null;
      logStatus.value = "idle";
      logLastError.value = null;
      return;
    }
    store.clear();
    realtimeEntries.value = [];
    realtimeTransports.value = [];
    realtimeEntriesTruncated.value = false;
    realtimeTransportsTruncated.value = false;
  }

  watch(options.active, (active) => {
    if (!active) {
      abort();
      cancelRealtimePublish();
      return;
    }
    scheduleRealtimePublish();
  });
  watch(options.mode, () => {
    closeDetail();
    scheduleRealtimePublish();
  });
  watch(options.storage, () => {
    if (options.mode.value === "log-analysis") clearActiveDataset();
  });
  watch(
    () => [options.draftRange.from, options.draftRange.to],
    () => {
      rangeError.value = null;
      if (logStatus.value === "loading") abortList();
    },
  );
  onScopeDispose(() => {
    abort();
    cancelRealtimePublish();
    removeSink();
  });

  return {
    abort,
    appliedRange,
    applyFilters,
    canApplyFilters,
    clearActiveDataset,
    closeDetail,
    detail,
    detailError,
    detailStatus,
    entries: filteredEntries,
    entriesTruncated,
    filterOptions,
    filters,
    queriedEntryCount: computed(() => filteredNamedEntries.value.length),
    lastError,
    rangeDirty,
    rangeError,
    resetFilters,
    run,
    selectEntry,
    selectedEntry,
    showUnidentifiedTransports,
    sources: computed(() =>
      options.mode.value === "log-analysis" ? (logResponse.value?.sources ?? []) : [],
    ),
    status,
    sort,
    transports: filteredTransports,
    unidentifiedTransportCount: computed(() => filteredTransports.value.length),
    transportsTruncated,
    truncated,
  };
}
