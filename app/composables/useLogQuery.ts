import { computed, reactive, shallowRef, watch } from "vue";
import type { Ref } from "vue";

import type { FirewallLogFilters, FirewallLogRecord } from "~/types/firewall";

import { trimToBufferSize } from "./useBoundedLogBuffer";

export function createDefaultLogFilters(): FirewallLogFilters {
  return {
    search: "",
    category: "",
    action: "",
    protocol: "",
    source: "",
    destination: "",
    from: "",
    to: "",
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

function isWithinTimeRange(log: FirewallLogRecord, filters: FirewallLogFilters) {
  const timestamp = new Date(log.timestamp).getTime();
  const from = filters.from ? new Date(filters.from).getTime() : Number.NEGATIVE_INFINITY;
  const to = filters.to ? new Date(filters.to).getTime() : Number.POSITIVE_INFINITY;

  return timestamp >= from && timestamp <= to;
}

export function filterFirewallLogs(
  logs: readonly FirewallLogRecord[],
  filters: FirewallLogFilters,
) {
  const search = filters.search.trim().toLowerCase();
  const category = filters.category.trim().toLowerCase();
  const action = filters.action.trim().toLowerCase();
  const protocol = filters.protocol.trim().toLowerCase();
  const source = filters.source.trim().toLowerCase();
  const destination = filters.destination.trim().toLowerCase();

  return logs.filter((log) => {
    return (
      includes(log.searchableText, search) &&
      includes(log.category, category) &&
      includes(log.action, action) &&
      includes(log.protocol, protocol) &&
      includes(`${log.sourceIp ?? ""}:${log.sourcePort ?? ""}`, source) &&
      includes(`${log.destinationIp ?? ""}:${log.destinationPort ?? ""}`, destination) &&
      isWithinTimeRange(log, filters)
    );
  });
}

export function hasActiveLogFilters(filters: FirewallLogFilters) {
  return Object.values(filters).some((value) => value.trim().length > 0);
}

export function getLogFiltersKey(filters: FirewallLogFilters) {
  return [
    filters.search,
    filters.category,
    filters.action,
    filters.protocol,
    filters.source,
    filters.destination,
    filters.from,
    filters.to,
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

  return trimToBufferSize(filterFirewallLogs(logs, filters), visibleLimit);
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
  visibleLimit: Readonly<Ref<number>> = computed(() => logs.value.length),
) {
  const filters = reactive(createDefaultLogFilters());
  const filterKey = computed(() => getLogFiltersKey(filters));
  const filteredLogs = shallowRef<FirewallLogRecord[]>([]);
  let previousFilterKey = filterKey.value;

  watch(
    [logs, filterKey, visibleLimit],
    ([nextLogs, nextFilterKey, nextVisibleLimit]) => {
      if (nextLogs.length === 0) {
        filteredLogs.value = [];
        previousFilterKey = nextFilterKey;
        return;
      }

      if (!hasActiveLogFilters(filters) || nextFilterKey !== previousFilterKey) {
        filteredLogs.value = queryFirewallLogs(nextLogs, filters, nextVisibleLimit);
        previousFilterKey = nextFilterKey;
        return;
      }

      filteredLogs.value = mergeFilteredLogCache(
        filterFirewallLogs(nextLogs, filters),
        filteredLogs.value,
        nextVisibleLimit,
      );
      previousFilterKey = nextFilterKey;
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
