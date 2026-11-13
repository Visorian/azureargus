import { computed, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue'
import type { Ref } from 'vue'

import type {
  FirewallLogFilters,
  FirewallLogRecord,
  FirewallLogSortState,
} from '#shared/types/firewall'
import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
  LogAnalyticsStorageKind,
} from '#shared/types/logAnalytics'
import { createDefaultLogFilters, getLogFiltersKey } from '~/composables/useLogQuery'
import {
  createDefaultLogAnalysisDateRange,
  LOG_ANALYSIS_ACTIONS,
  LOG_ANALYSIS_PROTOCOLS,
  parseLogAnalysisDateRange,
  resolveLogAnalysisDateRange,
} from '~/utils/logAnalysis'
import type { LogAnalysisDateRange, LogAnalysisRangePreset } from '~/utils/logAnalysis'

export type LogAnalyticsQueryStatus = 'idle' | 'loading' | 'success' | 'refreshing' | 'error'
type QueryRequest = (
  body: LogAnalyticsQueryRequest,
  signal: AbortSignal,
) => Promise<LogAnalyticsQueryResponse>
interface UseLogAnalyticsQueryOptions {
  active: Readonly<Ref<boolean>>
  filters: FirewallLogFilters
  queryLimit: Readonly<Ref<number>>
  rangePreset: Readonly<Ref<LogAnalysisRangePreset>>
  onBeforeReplace?: () => void
  onError?: (message: string) => void
  request?: QueryRequest
  sort: FirewallLogSortState
  storage: Readonly<Ref<LogAnalyticsStorageKind>>
  draftRange?: LogAnalysisDateRange
}

function queryError(error: unknown) {
  if (typeof error === 'object' && error !== null && 'data' in error) {
    const data = error.data
    if (
      typeof data === 'object' &&
      data !== null &&
      'message' in data &&
      typeof data.message === 'string'
    ) {
      return data.message
    }
  }
  return error instanceof Error ? error.message : 'Log Analytics query failed.'
}
const collator = new Intl.Collator()
function mergeOptions(current: readonly string[], values: readonly (string | undefined)[]) {
  const options = new Map(current.map((value) => [value.toLowerCase(), value]))
  for (const value of values) {
    if (value?.trim()) {
      options.set(value.trim().toLowerCase(), value.trim())
    }
  }
  return [...options.values()].toSorted((left, right) => collator.compare(left, right))
}

export function useLogAnalyticsQuery(options: UseLogAnalyticsQueryOptions) {
  let request: QueryRequest
  if (options.request) {
    request = options.request
  } else {
    const requestFetch = useRequestFetch()
    request = async (body, signal) =>
      await requestFetch<LogAnalyticsQueryResponse>('/api/log-analytics/query', {
        body,
        method: 'POST',
        signal,
      })
  }
  const records = shallowRef<FirewallLogRecord[]>([])
  const status = ref<LogAnalyticsQueryStatus>('idle')
  const lastError = ref<string | null>(null)
  const truncated = ref(false)
  const limit = ref<number | null>(null)
  const hasRun = ref(false)
  const datasetVersion = ref(0)
  const draftRange = options.draftRange ?? reactive(createDefaultLogAnalysisDateRange())
  const appliedRange = ref<{ from: string; to: string } | null>(null)
  const appliedFilters = reactive(createDefaultLogFilters())
  const rangeError = computed(() => {
    const parsed = parseLogAnalysisDateRange(draftRange)
    return parsed.ok ? null : parsed.error
  })
  const rangeDirty = computed(() => {
    if (!appliedRange.value) {
      return false
    }
    const parsed = parseLogAnalysisDateRange(draftRange)
    return (
      !parsed.ok ||
      parsed.value.from !== appliedRange.value.from ||
      parsed.value.to !== appliedRange.value.to
    )
  })
  const filtersDirty = computed(
    () => hasRun.value && getLogFiltersKey(options.filters) !== getLogFiltersKey(appliedFilters),
  )
  const actionOptions = ref<string[]>([...LOG_ANALYSIS_ACTIONS])
  const protocolOptions = ref<string[]>([...LOG_ANALYSIS_PROTOCOLS])
  const visibleLimit = computed(() => limit.value ?? 1_000)
  let controller: AbortController | null = null
  let generation = 0
  let rangeInitialized = options.active.value
  function abort() {
    generation += 1
    controller?.abort()
    controller = null
    if (status.value === 'loading' || status.value === 'refreshing') {
      status.value = hasRun.value ? 'success' : 'idle'
    }
  }
  async function run(requestForExecution: QueryRequest = request) {
    if (controller || !options.active.value) {
      return false
    }
    Object.assign(draftRange, resolveLogAnalysisDateRange(draftRange, options.rangePreset.value))
    const parsed = parseLogAnalysisDateRange(draftRange)
    if (!parsed.ok) {
      return false
    }
    const body: LogAnalyticsQueryRequest = {
      filters: { ...options.filters, category: [...options.filters.category] },
      from: parsed.value.from,
      to: parsed.value.to,
      limit: options.queryLimit.value,
      storage: options.storage.value,
      sort: { ...options.sort },
    }
    const execution = ++generation
    const activeController = new AbortController()
    controller = activeController
    status.value = records.value.length > 0 ? 'refreshing' : 'loading'
    lastError.value = null
    try {
      const response = await requestForExecution(body, activeController.signal)
      if (execution !== generation) {
        return false
      }
      options.onBeforeReplace?.()
      records.value = response.records
      appliedRange.value = { from: body.from, to: body.to }
      Object.assign(appliedFilters, body.filters, { category: [...body.filters.category] })
      truncated.value = response.truncated
      limit.value = response.limit
      hasRun.value = true
      status.value = 'success'
      datasetVersion.value += 1
      actionOptions.value = mergeOptions(
        actionOptions.value,
        response.records.map((record) => record.action),
      )
      protocolOptions.value = mergeOptions(
        protocolOptions.value,
        response.records.map((record) => record.protocol),
      )
      return true
    } catch (error: unknown) {
      if (execution !== generation || (error instanceof Error && error.name === 'AbortError')) {
        return false
      }
      lastError.value = queryError(error)
      status.value = 'error'
      options.onError?.(lastError.value)
      return false
    } finally {
      if (execution === generation) {
        controller = null
      }
    }
  }
  function clear() {
    abort()
    options.onBeforeReplace?.()
    records.value = []
    status.value = 'idle'
    lastError.value = null
    truncated.value = false
    limit.value = null
    hasRun.value = false
    appliedRange.value = null
    Object.assign(appliedFilters, createDefaultLogFilters())
    actionOptions.value = [...LOG_ANALYSIS_ACTIONS]
    protocolOptions.value = [...LOG_ANALYSIS_PROTOCOLS]
    datasetVersion.value += 1
  }
  watch(options.active, (active) => {
    if (active && !rangeInitialized && !hasRun.value) {
      Object.assign(draftRange, resolveLogAnalysisDateRange(draftRange, options.rangePreset.value))
      rangeInitialized = true
    } else if (!active) {
      abort()
    }
  })
  watch(options.storage, clear)
  onScopeDispose(abort)
  return {
    records,
    status,
    lastError,
    truncated,
    limit,
    hasRun,
    datasetVersion,
    draftRange,
    appliedRange,
    appliedFilters,
    rangeError,
    rangeDirty,
    filtersDirty,
    actionOptions,
    protocolOptions,
    visibleLimit,
    abort,
    clear,
    run,
    addActionOption: (value: string) => {
      actionOptions.value = mergeOptions(actionOptions.value, [value])
    },
    addProtocolOption: (value: string) => {
      protocolOptions.value = mergeOptions(protocolOptions.value, [value])
    },
  }
}
