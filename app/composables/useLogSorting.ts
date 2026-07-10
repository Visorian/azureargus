import type { Ref } from "vue";

import type {
  FirewallLogRecord,
  FirewallLogSortDirection,
  FirewallLogSortKey,
  FirewallLogSortState,
} from "~/types/firewall";

export function createDefaultLogSort(): FirewallLogSortState {
  return {
    key: "timestamp",
    direction: "desc",
  };
}

function normalizeSortValue(log: FirewallLogRecord, key: FirewallLogSortKey) {
  if (key === "timestamp") {
    return new Date(log.timestamp).getTime();
  }

  return (log[key] ?? "").toLowerCase();
}

function compareValues(left: number | string, right: number | string) {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }

  return String(left).localeCompare(String(right));
}

export function compareFirewallLogs(
  left: FirewallLogRecord,
  right: FirewallLogRecord,
  key: FirewallLogSortKey,
) {
  const result = compareValues(normalizeSortValue(left, key), normalizeSortValue(right, key));
  return result === 0 ? left.id.localeCompare(right.id) : result;
}

export function sortFirewallLogs(
  logs: FirewallLogRecord[],
  sort: FirewallLogSortState,
  assumeTimestampDescending = true,
) {
  if (assumeTimestampDescending && sort.key === "timestamp" && sort.direction === "desc") {
    return logs;
  }

  const direction = sort.direction === "asc" ? 1 : -1;
  return [...logs].sort((left, right) => compareFirewallLogs(left, right, sort.key) * direction);
}

export function getNextSortDirection(
  current: FirewallLogSortState,
  key: FirewallLogSortKey,
): FirewallLogSortDirection {
  if (current.key === key) {
    return current.direction === "asc" ? "desc" : "asc";
  }

  return key === "timestamp" ? "desc" : "asc";
}

export function useLogSorting(
  logs: Readonly<Ref<FirewallLogRecord[]>>,
  assumeTimestampDescending = true,
  providedSort?: FirewallLogSortState,
) {
  const sort = providedSort ?? reactive(createDefaultLogSort());
  const sortedLogs = computed(() => sortFirewallLogs(logs.value, sort, assumeTimestampDescending));

  function setSort(key: FirewallLogSortKey) {
    sort.direction = getNextSortDirection(sort, key);
    sort.key = key;
  }

  function getSortIcon(key: FirewallLogSortKey) {
    if (sort.key !== key) {
      return "i-lucide-arrow-up-down";
    }

    return sort.direction === "asc" ? "i-lucide-arrow-up" : "i-lucide-arrow-down";
  }

  function getAriaSort(key: FirewallLogSortKey) {
    if (sort.key !== key) {
      return "none";
    }

    return sort.direction === "asc" ? "ascending" : "descending";
  }

  return {
    sort,
    sortedLogs,
    setSort,
    getSortIcon,
    getAriaSort,
  };
}
