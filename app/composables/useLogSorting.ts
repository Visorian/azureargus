import type { ComputedRef, Ref } from 'vue'

import type {
  FirewallLogRecord,
  FirewallLogSortDirection,
  FirewallLogSortKey,
  FirewallLogSortState,
} from '#shared/types/firewall'

export interface UseLogSortingReturn {
  sort: FirewallLogSortState
  sortedLogs: ComputedRef<FirewallLogRecord[]>
  setSort: (key: FirewallLogSortKey) => void
  getSortIcon: (key: FirewallLogSortKey) => string
  getAriaSort: (key: FirewallLogSortKey) => 'none' | 'ascending' | 'descending'
}

export function createDefaultLogSort(): FirewallLogSortState {
  return {
    key: 'timestamp',
    direction: 'desc',
  }
}

const PORT_PATTERN = /^\d{1,5}$/u

type SortValue = number | string

// Ranks keep the order transitive: missing values first, then valid ports, then other text.
function normalizePortValue(value: string | undefined): [rank: number, value: SortValue] {
  const text = value?.trim() ?? ''
  if (text === '') {
    return [0, '']
  }

  const port = Number(text)
  return PORT_PATTERN.test(text) && port <= 65535 ? [1, port] : [2, text.toLowerCase()]
}

function normalizeSortValue(
  log: FirewallLogRecord,
  key: FirewallLogSortKey,
): [rank: number, value: SortValue] {
  if (key === 'timestamp') {
    return [0, new Date(log.timestamp).getTime()]
  }
  if (key === 'sourcePort' || key === 'destinationPort') {
    return normalizePortValue(log[key])
  }

  return [0, (log[key] ?? '').toLowerCase()]
}

function compareValues(
  [leftRank, left]: [number, SortValue],
  [rightRank, right]: [number, SortValue],
) {
  if (leftRank !== rightRank) {
    return leftRank - rightRank
  }
  if (typeof left === 'number' && typeof right === 'number') {
    return left - right
  }

  return String(left).localeCompare(String(right))
}

export function compareFirewallLogs(
  left: FirewallLogRecord,
  right: FirewallLogRecord,
  key: FirewallLogSortKey,
): number {
  const result = compareValues(normalizeSortValue(left, key), normalizeSortValue(right, key))
  return result === 0 ? left.id.localeCompare(right.id) : result
}

export function sortFirewallLogs(
  logs: FirewallLogRecord[],
  sort: FirewallLogSortState,
): FirewallLogRecord[] {
  const direction = sort.direction === 'asc' ? 1 : -1
  const compare = (left: FirewallLogRecord, right: FirewallLogRecord) =>
    compareFirewallLogs(left, right, sort.key) * direction

  let previous: FirewallLogRecord | undefined
  for (const log of logs) {
    if (previous !== undefined && compare(previous, log) > 0) {
      return logs.toSorted(compare)
    }
    previous = log
  }

  return logs
}

export function getNextSortDirection(
  current: FirewallLogSortState,
  key: FirewallLogSortKey,
): FirewallLogSortDirection {
  if (current.key === key) {
    return current.direction === 'asc' ? 'desc' : 'asc'
  }

  return key === 'timestamp' ? 'desc' : 'asc'
}

export function useLogSorting(
  logs: Readonly<Ref<FirewallLogRecord[]>>,
  providedSort?: FirewallLogSortState,
): UseLogSortingReturn {
  const sort = providedSort ?? reactive(createDefaultLogSort())
  const sortedLogs = computed(() => sortFirewallLogs(logs.value, sort))

  function setSort(key: FirewallLogSortKey) {
    sort.direction = getNextSortDirection(sort, key)
    sort.key = key
  }

  function getSortIcon(key: FirewallLogSortKey) {
    if (sort.key !== key) {
      return 'i-lucide-arrow-up-down'
    }

    return sort.direction === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'
  }

  function getAriaSort(key: FirewallLogSortKey) {
    if (sort.key !== key) {
      return 'none'
    }

    return sort.direction === 'asc' ? 'ascending' : 'descending'
  }

  return {
    sort,
    sortedLogs,
    setSort,
    getSortIcon,
    getAriaSort,
  }
}
