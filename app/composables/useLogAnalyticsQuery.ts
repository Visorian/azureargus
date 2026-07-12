import { computed, onScopeDispose, reactive, ref, shallowRef, watch, type Ref } from "vue";

import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
} from "#shared/types/logAnalytics";
import {
  createDefaultLogAnalysisDateRange,
  getLogAnalysisCriteriaKey,
  LOG_ANALYSIS_ACTIONS,
  LOG_ANALYSIS_PROTOCOLS,
  parseLogAnalysisDateRange,
} from "~/utils/logAnalysis";
import type { FirewallLogFilters, FirewallLogRecord, FirewallLogSortState } from "~/types/firewall";

export type LogAnalyticsQueryStatus = "idle" | "loading" | "success" | "refreshing" | "error";
type QueryRequest = (
  body: LogAnalyticsQueryRequest,
  signal: AbortSignal,
) => Promise<LogAnalyticsQueryResponse>;

interface UseLogAnalyticsQueryOptions {
  active: Readonly<Ref<boolean>>;
  filters: FirewallLogFilters;
  onBeforeReplace?: () => void;
  onError?: (message: string) => void;
  request?: QueryRequest;
  sort: FirewallLogSortState;
}

function getErrorMessage(error: unknown) {
  if (typeof error === "object" && error !== null && "data" in error) {
    const data = error.data;
    if (typeof data === "object" && data !== null && "message" in data) {
      const message = data.message;
      if (typeof message === "string" && message.length > 0) {
        return message;
      }
    }
  }

  return error instanceof Error ? error.message : "Log Analytics query failed.";
}

function isAbortError(error: unknown) {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}

function mergeOptions(current: readonly string[], values: readonly (string | undefined)[]) {
  const options = new Map(current.map((value) => [value.toLowerCase(), value]));
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      options.set(trimmed.toLowerCase(), trimmed);
    }
  }
  return [...options.values()].toSorted((left, right) => left.localeCompare(right));
}

export function useLogAnalyticsQuery(options: UseLogAnalyticsQueryOptions) {
  const requestFetch = options.request === undefined ? useRequestFetch() : null;
  const request =
    options.request ??
    ((body: LogAnalyticsQueryRequest, signal: AbortSignal) => {
      if (requestFetch === null) {
        throw new Error("Log Analytics request fetch is unavailable.");
      }
      return requestFetch<LogAnalyticsQueryResponse>("/api/log-analytics/query", {
        body,
        method: "POST",
        signal,
      });
    });
  const records = shallowRef<FirewallLogRecord[]>([]);
  const status = ref<LogAnalyticsQueryStatus>("idle");
  const lastError = ref<string | null>(null);
  const truncated = ref(false);
  const limit = ref<number | null>(null);
  const hasRun = ref(false);
  const datasetVersion = ref(0);
  const draftRange = reactive(createDefaultLogAnalysisDateRange());
  const appliedRange = ref<{ from: string; to: string } | null>(null);
  const rangeError = ref<string | null>(null);
  const refinementPending = ref(false);
  const actionOptions = ref<string[]>([...LOG_ANALYSIS_ACTIONS]);
  const protocolOptions = ref<string[]>([...LOG_ANALYSIS_PROTOCOLS]);
  const criteriaKey = computed(() => getLogAnalysisCriteriaKey(options.filters, options.sort));
  const rangeDirty = computed(() => {
    if (appliedRange.value === null) {
      return false;
    }

    const parsed = parseLogAnalysisDateRange(draftRange);
    return (
      !parsed.ok ||
      parsed.value.from !== appliedRange.value.from ||
      parsed.value.to !== appliedRange.value.to
    );
  });
  const visibleLimit = computed(() => limit.value ?? 1_000);
  const canApplyFilters = computed(
    () =>
      refinementPending.value || (hasRun.value && lastError.value !== null && !rangeDirty.value),
  );
  let activeController: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let requestGeneration = 0;
  let criteriaChangedDuringInitialLoad = false;
  let rangeInitialized = options.active.value;

  function clearDebounce() {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    refinementPending.value = false;
  }

  function abortActiveRequest() {
    requestGeneration += 1;
    activeController?.abort();
    activeController = null;

    if (status.value === "refreshing") {
      status.value = "success";
    } else if (status.value === "loading" && !hasRun.value) {
      status.value = "idle";
    }
  }

  function abort() {
    clearDebounce();
    abortActiveRequest();
  }

  function createRequestBody(range: { from: string; to: string }): LogAnalyticsQueryRequest {
    return {
      filters: {
        action: options.filters.action,
        category: options.filters.category,
        destination: options.filters.destination,
        protocol: options.filters.protocol,
        search: options.filters.search,
        source: options.filters.source,
      },
      from: range.from,
      sort: {
        direction: options.sort.direction,
        key: options.sort.key,
      },
      to: range.to,
    };
  }

  async function execute(range: { from: string; to: string }, initial: boolean) {
    clearDebounce();
    abortActiveRequest();
    const controller = new AbortController();
    const generation = requestGeneration + 1;
    requestGeneration = generation;
    activeController = controller;
    const requestedCriteriaKey = criteriaKey.value;
    status.value = initial && records.value.length === 0 ? "loading" : "refreshing";
    lastError.value = null;

    try {
      const response = await request(createRequestBody(range), controller.signal);
      if (generation !== requestGeneration || !options.active.value) {
        return false;
      }

      options.onBeforeReplace?.();
      records.value = response.records;
      truncated.value = response.truncated;
      limit.value = response.limit;
      appliedRange.value = range;
      hasRun.value = true;
      status.value = "success";
      datasetVersion.value += 1;
      actionOptions.value = mergeOptions(
        actionOptions.value,
        response.records.map((record) => record.action),
      );
      protocolOptions.value = mergeOptions(
        protocolOptions.value,
        response.records.map((record) => record.protocol),
      );

      if (requestedCriteriaKey !== criteriaKey.value || criteriaChangedDuringInitialLoad) {
        criteriaChangedDuringInitialLoad = false;
        scheduleRefinement();
      }
      return true;
    } catch (error: unknown) {
      if (generation !== requestGeneration || isAbortError(error)) {
        return false;
      }

      const message = getErrorMessage(error);
      lastError.value = message;
      status.value = records.value.length > 0 ? "success" : "error";
      options.onError?.(message);
      return false;
    } finally {
      if (generation === requestGeneration) {
        activeController = null;
      }
    }
  }

  async function run() {
    const parsed = parseLogAnalysisDateRange(draftRange);
    if (!parsed.ok) {
      rangeError.value = parsed.error;
      return false;
    }

    rangeError.value = null;
    criteriaChangedDuringInitialLoad = false;
    return execute(parsed.value, !hasRun.value);
  }

  function scheduleRefinement(immediate = false) {
    if (!options.active.value || !hasRun.value || appliedRange.value === null || rangeDirty.value) {
      return;
    }
    if (immediate && !refinementPending.value && lastError.value === null) {
      return;
    }

    clearDebounce();
    abortActiveRequest();
    refinementPending.value = true;

    const trigger = () => {
      debounceTimer = null;
      refinementPending.value = false;
      if (appliedRange.value !== null) {
        void execute(appliedRange.value, false);
      }
    };

    if (immediate) {
      trigger();
      return;
    }

    debounceTimer = setTimeout(trigger, 500);
  }

  function clear() {
    abort();
    options.onBeforeReplace?.();
    records.value = [];
    status.value = "idle";
    lastError.value = null;
    truncated.value = false;
    limit.value = null;
    hasRun.value = false;
    appliedRange.value = null;
    rangeError.value = null;
    criteriaChangedDuringInitialLoad = false;
    actionOptions.value = [...LOG_ANALYSIS_ACTIONS];
    protocolOptions.value = [...LOG_ANALYSIS_PROTOCOLS];
    datasetVersion.value += 1;
  }

  function addActionOption(value: string) {
    actionOptions.value = mergeOptions(actionOptions.value, [value]);
  }

  function addProtocolOption(value: string) {
    protocolOptions.value = mergeOptions(protocolOptions.value, [value]);
  }

  watch(criteriaKey, () => {
    if (!options.active.value) {
      return;
    }
    if (status.value === "loading" && !hasRun.value) {
      criteriaChangedDuringInitialLoad = true;
      return;
    }
    scheduleRefinement();
  });

  watch(
    () => [draftRange.from, draftRange.to],
    () => {
      rangeError.value = null;
      if (status.value === "loading" || status.value === "refreshing") {
        abort();
      }
    },
  );

  watch(options.active, (active) => {
    if (active && !rangeInitialized) {
      Object.assign(draftRange, createDefaultLogAnalysisDateRange());
      rangeInitialized = true;
    } else if (!active) {
      abort();
    }
  });

  onScopeDispose(abort);

  return {
    addActionOption,
    addProtocolOption,
    actionOptions,
    appliedRange,
    abort,
    canApplyFilters,
    clear,
    datasetVersion,
    draftRange,
    hasRun,
    lastError,
    limit,
    protocolOptions,
    rangeDirty,
    rangeError,
    records,
    refinementPending,
    run,
    scheduleRefinement,
    status,
    truncated,
    visibleLimit,
  };
}
