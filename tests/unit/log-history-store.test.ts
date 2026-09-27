import type { PersistedFirewallLogRecord } from '../../app/utils/logHistoryRecord'
import { createLogHistoryStore } from '../../app/utils/logHistoryStore'
import type { LogHistoryStoreAdapter } from '../../app/utils/logHistoryStore'

function createRecord(id: string): PersistedFirewallLogRecord {
  return {
    id,
    timestamp: '2026-07-09T12:00:00.000Z',
    category: 'AZFWNetworkRule',
    action: 'Allow',
    protocol: 'TCP',
    message: id,
    searchableText: id,
  }
}

function createAdapter() {
  return {
    clear: vi.fn<LogHistoryStoreAdapter['clear']>(async () => {}),
    deleteBefore: vi.fn<LogHistoryStoreAdapter['deleteBefore']>(async () => 0),
    deleteExcessRecords: vi.fn<LogHistoryStoreAdapter['deleteExcessRecords']>(async () => 0),
    putMany: vi.fn<LogHistoryStoreAdapter['putMany']>(async () => {}),
    queryRange: vi.fn<LogHistoryStoreAdapter['queryRange']>(async () => []),
  } satisfies LogHistoryStoreAdapter
}

describe('log history store', () => {
  it('persists a batch before enforcing retention', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-09T12:01:30.000Z'))
    const calls: string[] = []
    const records = [createRecord('first'), createRecord('second')]
    const adapter = createAdapter()
    adapter.putMany.mockImplementation(async () => {
      calls.push('put')
    })
    adapter.deleteBefore.mockImplementation(async () => {
      calls.push('delete-before')
      return 0
    })
    adapter.deleteExcessRecords.mockImplementation(async () => {
      calls.push('delete-excess')
      return 0
    })
    const store = createLogHistoryStore(adapter)

    await store.appendLogHistoryBatch(records, { maxAgeMs: 120_000, maxRecords: 1 })

    expect(calls).toEqual(['put', 'delete-before', 'delete-excess'])
    expect(adapter.putMany).toHaveBeenCalledWith(records)
    expect(adapter.deleteBefore).toHaveBeenCalledWith('2026-07-09T11:59:30.000Z')
    expect(adapter.deleteExcessRecords).toHaveBeenCalledWith(1)
    vi.useRealTimers()
  })

  it('skips storage work for an empty batch', async () => {
    const adapter = createAdapter()
    const store = createLogHistoryStore(adapter)

    await store.appendLogHistoryBatch([])

    expect(adapter.putMany).not.toHaveBeenCalled()
    expect(adapter.deleteBefore).not.toHaveBeenCalled()
    expect(adapter.deleteExcessRecords).not.toHaveBeenCalled()
  })

  it('normalizes query limits at the store boundary', async () => {
    const adapter = createAdapter()
    const store = createLogHistoryStore(adapter)

    await store.queryLogHistoryRange({ from: '2026-07-09T12:00:00.000Z', limit: 2.9 })
    await store.queryLogHistoryRange({ limit: Number.NaN })

    expect(adapter.queryRange).toHaveBeenNthCalledWith(1, {
      from: '2026-07-09T12:00:00.000Z',
      limit: 2,
    })
    expect(adapter.queryRange).toHaveBeenNthCalledWith(2, { limit: 0 })
  })
})
