import { effectScope, nextTick, reactive, ref } from 'vue'

import { useLogAnalyticsQuery } from '../../app/composables/useLogAnalyticsQuery'
import { createDefaultLogFilters } from '../../app/composables/useLogQuery'
import { createDefaultLogSort } from '../../app/composables/useLogSorting'
import {
  createDefaultLogAnalysisDateRange,
  parseLogAnalysisDateRange,
} from '../../app/utils/logAnalysis'
import type { LogAnalysisRangePreset } from '../../app/utils/logAnalysis'
import type { FirewallLogRecord } from '../../shared/types/firewall'
import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
  LogAnalyticsStorageKind,
} from '../../shared/types/logAnalytics'

function response(id: string): LogAnalyticsQueryResponse {
  const record: FirewallLogRecord = {
    id,
    timestamp: '2026-07-10T10:00:00.000Z',
    category: 'AZFWNetworkRule',
    action: 'Allow',
    protocol: 'TCP',
    message: id,
    raw: {},
    searchableText: id,
  }
  return { records: [record], truncated: false, limit: 1_000 }
}
function createQuery(
  request: (
    body: LogAnalyticsQueryRequest,
    signal: AbortSignal,
  ) => Promise<LogAnalyticsQueryResponse>,
  initiallyActive = true,
) {
  const scope = effectScope()
  const filters = reactive(createDefaultLogFilters())
  const active = ref(initiallyActive)
  const storage = ref<LogAnalyticsStorageKind>('resource-specific')
  const rangePreset = ref<LogAnalysisRangePreset>('custom')
  const query = scope.run(() =>
    useLogAnalyticsQuery({
      active,
      filters,
      queryLimit: ref(1_000),
      rangePreset,
      request,
      sort: reactive(createDefaultLogSort()),
      storage,
    }),
  )
  if (!query) {
    throw new Error('Query scope did not initialize')
  }
  return { scope, filters, active, storage, rangePreset, query }
}

describe('Log analysis client', () => {
  afterEach(() => vi.useRealTimers())

  it('creates and validates explicit UTC ranges', () => {
    const range = createDefaultLogAnalysisDateRange(new Date('2026-07-10T12:00:00Z'))
    expect(range).toStrictEqual({ from: '2026-07-10T11:45', to: '2026-07-10T12:00' })
    expect(parseLogAnalysisDateRange(range)).toStrictEqual({
      ok: true,
      value: { from: '2026-07-10T11:45:00.000Z', to: '2026-07-10T12:00:00.000Z' },
    })
    expect(parseLogAnalysisDateRange({ from: '2026-07-10T12:00', to: '2026-07-09T12:00' }).ok).toBe(
      false,
    )
    expect(parseLogAnalysisDateRange({ from: '', to: '2026-07-10T12:00' }).ok).toBe(false)
  })

  it('refreshes relative presets on each run and preserves a custom range', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T10:00:00Z'))
    const requests: LogAnalyticsQueryRequest[] = []
    const { query, rangePreset, scope } = createQuery(async (body) => {
      requests.push(body)
      return response('result')
    })
    try {
      rangePreset.value = '15'
      vi.setSystemTime(new Date('2026-07-10T10:15:00Z'))
      await query.run()
      expect(requests[0]).toMatchObject({
        from: '2026-07-10T10:00:00.000Z',
        to: '2026-07-10T10:15:00.000Z',
      })
      vi.setSystemTime(new Date('2026-07-10T11:15:00Z'))
      await query.run()
      expect(requests[1]).toMatchObject({
        from: '2026-07-10T11:00:00.000Z',
        to: '2026-07-10T11:15:00.000Z',
      })
      rangePreset.value = '60'
      vi.setSystemTime(new Date('2026-07-10T11:45:00Z'))
      await query.run()
      expect(requests[2]).toMatchObject({
        from: '2026-07-10T10:45:00.000Z',
        to: '2026-07-10T11:45:00.000Z',
      })
      rangePreset.value = 'custom'
      Object.assign(query.draftRange, { from: '2026-07-10T08:00', to: '2026-07-10T09:00' })
      vi.setSystemTime(new Date('2026-07-10T12:30:00Z'))
      await query.run()
      expect(requests[3]).toMatchObject({
        from: '2026-07-10T08:00:00.000Z',
        to: '2026-07-10T09:00:00.000Z',
      })
    } finally {
      scope.stop()
    }
  })

  it('keeps historical edits pending until an explicit run', async () => {
    vi.useFakeTimers()
    const requests: LogAnalyticsQueryRequest[] = []
    const { query, filters, scope } = createQuery(async (body) => {
      requests.push(body)
      return response(`query-${requests.length}`)
    })
    try {
      await query.run()
      filters.action = 'Deny'
      filters.category = ['AZFWNetworkRule']
      await nextTick()
      await vi.advanceTimersByTimeAsync(1_000)
      expect(requests).toHaveLength(1)
      expect(query.records.value[0]?.id).toBe('query-1')
      expect(query.appliedFilters.action).toBe('')
      expect(query.filtersDirty.value).toBe(true)
      await query.run()
      expect(requests).toHaveLength(2)
      expect(requests[1]?.filters).toMatchObject({ action: 'Deny', category: ['AZFWNetworkRule'] })
      expect(query.appliedFilters.action).toBe('Deny')
      expect(query.filtersDirty.value).toBe(false)
      query.clear()
      expect(query.records.value).toStrictEqual([])
      expect(query.hasRun.value).toBe(false)
      expect(filters.action).toBe('Deny')
    } finally {
      scope.stop()
    }
  })

  it('applies the requested snapshot and preserves drafts edited in flight', async () => {
    const deferred = Promise.withResolvers<LogAnalyticsQueryResponse>()
    const requests: LogAnalyticsQueryRequest[] = []
    const { query, filters, scope } = createQuery(async (body) => {
      requests.push(body)
      return await deferred.promise
    })
    try {
      filters.action = 'Allow'
      const originalRange = { ...query.draftRange }
      const running = query.run()
      filters.action = 'Deny'
      query.draftRange.from = '2026-07-10T08:00'
      await nextTick()
      await expect(query.run()).resolves.toBe(false)
      expect(requests).toHaveLength(1)
      deferred.resolve(response('requested-snapshot'))
      await expect(running).resolves.toBe(true)
      expect(query.appliedFilters.action).toBe('Allow')
      expect(filters.action).toBe('Deny')
      expect(query.filtersDirty.value).toBe(true)
      expect(query.rangeDirty.value).toBe(true)
      expect(requests[0]?.from).toBe(
        parseLogAnalysisDateRange(originalRange).ok ? `${originalRange.from}:00.000Z` : '',
      )
    } finally {
      scope.stop()
    }
  })

  it('keeps previous results and applied criteria after a failed run', async () => {
    let requests = 0
    const { query, filters, scope } = createQuery(async () => {
      requests += 1
      if (requests === 2) {
        throw new Error('Workspace unavailable')
      }
      return response(`query-${requests}`)
    })
    try {
      await query.run()
      filters.protocol = 'UDP'
      await expect(query.run()).resolves.toBe(false)
      expect(query.records.value[0]?.id).toBe('query-1')
      expect(query.appliedFilters.protocol).toBe('')
      expect(query.status.value).toBe('error')
      expect(query.lastError.value).toBe('Workspace unavailable')
      await query.run()
      expect(query.lastError.value).toBeNull()
      expect(query.records.value[0]?.id).toBe('query-3')
    } finally {
      scope.stop()
    }
  })

  it('cancels in-flight requests when the source becomes inactive', async () => {
    let signal: AbortSignal | undefined
    const { query, active, scope } = createQuery(async (_body, requestSignal) => {
      signal = requestSignal
      return await new Promise((_resolve, reject) => {
        requestSignal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    try {
      const running = query.run()
      active.value = false
      await nextTick()
      await expect(running).resolves.toBe(false)
      expect(signal?.aborted).toBe(true)
      expect(query.lastError.value).toBeNull()
      expect(query.status.value).toBe('idle')
    } finally {
      scope.stop()
    }
  })

  it('clears retained results when storage changes and refreshes the range on first activation', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T10:00:00Z'))
    const requests: LogAnalyticsQueryRequest[] = []
    const { query, storage, active, rangePreset, scope } = createQuery(async (body) => {
      requests.push(body)
      return response('result')
    }, false)
    try {
      rangePreset.value = '15'
      vi.setSystemTime(new Date('2026-07-10T11:00:00Z'))
      active.value = true
      await nextTick()
      expect(query.draftRange).toStrictEqual({ from: '2026-07-10T10:45', to: '2026-07-10T11:00' })
      await query.run()
      storage.value = 'azure-diagnostics'
      await nextTick()
      expect(query.records.value).toStrictEqual([])
      expect(query.hasRun.value).toBe(false)
      await query.run()
      expect(requests[1]?.storage).toBe('azure-diagnostics')
    } finally {
      scope.stop()
    }
  })
})
