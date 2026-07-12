import { computed, reactive, shallowRef, watch } from "vue";
import type { Ref } from "vue";

import type { FirewallLogFilters, FirewallLogRecord } from "~/types/firewall";

import { trimToBufferSize } from "./useBoundedLogBuffer";

interface LogQueryRawSource {
  getRecords(): readonly FirewallLogRecord[];
  version: Readonly<Ref<number>>;
}

interface UseLogQueryOptions {
  datasetKey?: Readonly<Ref<number | string>>;
  filters?: FirewallLogFilters;
  rawSource?: LogQueryRawSource;
  visibleLimit?: Readonly<Ref<number>>;
}

export function createDefaultLogFilters(): FirewallLogFilters {
  return {
    search: "",
    category: "",
    action: "",
    protocol: "",
    source: "",
    destination: "",
  };
}

export function createCaseInsensitiveFilterOptions(
  values: readonly (string | undefined)[],
  formatValue: (value: string) => string = (value) => value,
) {
  const seen = new Set<string>();
  const options: string[] = [];

  for (const value of values) {
    const trimmed = value?.trim();
    if (!trimmed) {
      continue;
    }

    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    options.push(formatValue(trimmed));
  }

  return options.sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

function includes(value: string | undefined, query: string) {
  return query.length === 0 || (value ?? "").toLowerCase().includes(query);
}

export function filterFirewallLogs(
  logs: readonly FirewallLogRecord[],
  filters: FirewallLogFilters,
  limit?: number,
) {
  const search = filters.search.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();
  const action = filters.action.trim().toLowerCase();
  const protocol = filters.protocol.trim().toLowerCase();
  const source = filters.source.trim().toLowerCase();
  const destination = filters.destination.trim().toLowerCase();
  const maxMatches =
    limit === undefined
      ? Number.POSITIVE_INFINITY
      : Number.isFinite(limit)
        ? Math.max(0, Math.floor(limit))
        : 0;
  const matches: FirewallLogRecord[] = [];
  if (maxMatches === 0) {
    return matches;
  }

  for (const log of logs) {
    if (
      (search.length === 0 || log.searchableText.includes(search)) &&
      includes(log.category, category) &&
      includes(log.action, action) &&
      includes(log.protocol, protocol) &&
      (source.length === 0 || includes(`${log.sourceIp ?? ""}:${log.sourcePort ?? ""}`, source)) &&
      (destination.length === 0 ||
        includes(`${log.destinationIp ?? ""}:${log.destinationPort ?? ""}`, destination))
    ) {
      matches.push(log);
      if (matches.length >= maxMatches) {
        break;
      }
    }
  }

  return matches;
}

export function hasActiveLogFilters(filters: FirewallLogFilters) {
  return Object.values(filters).some((value) => value.trim().length > 0);
}

export function isLogFilterValueActive(currentValue: string, candidateValue: string | undefined) {
  return Boolean(
    candidateValue && currentValue.trim().toLowerCase() === candidateValue.trim().toLowerCase(),
  );
}

export function toggleLogFilterValue(currentValue: string, candidateValue: string | undefined) {
  const nextValue = candidateValue?.trim();
  if (!nextValue) {
    return currentValue;
  }

  return isLogFilterValueActive(currentValue, nextValue) ? "" : nextValue;
}

export function getLogFiltersKey(filters: FirewallLogFilters) {
  return [
    filters.search,
    filters.category,
    filters.action,
    filters.protocol,
    filters.source,
    filters.destination,
  ]
    .map((value) => value.trim().toLowerCase())
    .join("\u001F");
}

export function queryFirewallLogs(
  logs: readonly FirewallLogRecord[],
  filters: FirewallLogFilters,
  visibleLimit: number,
) {
  if (!hasActiveLogFilters(filters)) {
    return trimToBufferSize(logs, visibleLimit);
  }

  return filterFirewallLogs(logs, filters, visibleLimit);
}

export function mergeFilteredLogCache(
  currentMatches: readonly FirewallLogRecord[],
  cachedMatches: readonly FirewallLogRecord[],
  visibleLimit: number,
) {
  const seen = new Set<string>();
  const merged: FirewallLogRecord[] = [];

  for (const log of currentMatches.concat(cachedMatches)) {
    if (seen.has(log.id)) {
      continue;
    }

    seen.add(log.id);
    merged.push(log);
  }

  return trimToBufferSize(merged, visibleLimit);
}

export function useLogQuery(
  logs: Ref<FirewallLogRecord[]>,
  {
    datasetKey = computed(() => "default"),
    filters: providedFilters,
    rawSource,
    visibleLimit = computed(() => logs.value.length),
  }: UseLogQueryOptions = {},
) {
  const filters = providedFilters ?? reactive(createDefaultLogFilters());
  const filterKey = computed(() => getLogFiltersKey(filters));
  const filteredLogs = shallowRef<FirewallLogRecord[]>([]);
  let previousFilterKey = filterKey.value;
  let previousDatasetKey = datasetKey.value;
  const rawSourceVersion = rawSource?.version ?? computed(() => 0);

  watch(
    [logs, filterKey, visibleLimit, datasetKey, rawSourceVersion],
    ([publishedLogs, nextFilterKey, nextVisibleLimit, nextDatasetKey]) => {
      const nextLogs = hasActiveLogFilters(filters)
        ? (rawSource?.getRecords() ?? publishedLogs)
        : publishedLogs;
      if (nextLogs.length === 0) {
        filteredLogs.value = [];
        previousFilterKey = nextFilterKey;
        previousDatasetKey = nextDatasetKey;
        return;
      }

      if (
        !hasActiveLogFilters(filters) ||
        nextFilterKey !== previousFilterKey ||
        nextDatasetKey !== previousDatasetKey
      ) {
        filteredLogs.value = queryFirewallLogs(nextLogs, filters, nextVisibleLimit);
        previousFilterKey = nextFilterKey;
        previousDatasetKey = nextDatasetKey;
        return;
      }

      filteredLogs.value = mergeFilteredLogCache(
        filterFirewallLogs(nextLogs, filters, nextVisibleLimit),
        filteredLogs.value,
        nextVisibleLimit,
      );
      previousFilterKey = nextFilterKey;
      previousDatasetKey = nextDatasetKey;
    },
    { immediate: true },
  );

  function resetFilters() {
    Object.assign(filters, createDefaultLogFilters());
  }

  return {
    filters,
    filteredLogs,
    resetFilters,
  };
}
