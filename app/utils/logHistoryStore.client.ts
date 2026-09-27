import {
  isPersistedFirewallLogRecord,
  LOG_HISTORY_ACTION_INDEX,
  LOG_HISTORY_CATEGORY_INDEX,
  LOG_HISTORY_DB_NAME,
  LOG_HISTORY_DB_VERSION,
  LOG_HISTORY_PROTOCOL_INDEX,
  LOG_HISTORY_STORE_NAME,
  LOG_HISTORY_TIMESTAMP_INDEX,
} from './logHistoryRecord'
import type { PersistedFirewallLogRecord } from './logHistoryRecord'
import { createLogHistoryStore } from './logHistoryStore'
import type { LogHistoryRangeQuery, LogHistoryStoreAdapter } from './logHistoryStore'

function getIndexedDBError(error: DOMException | null, fallback: string) {
  return error ?? new Error(fallback)
}

function createTimestampRange({ from, to }: LogHistoryRangeQuery): IDBKeyRange | undefined {
  if (from && to) {
    return IDBKeyRange.bound(from, to)
  }
  if (from) {
    return IDBKeyRange.lowerBound(from)
  }
  if (to) {
    return IDBKeyRange.upperBound(to)
  }

  return undefined
}

function createIndex(store: IDBObjectStore, name: string, keyPath: string) {
  if (store.indexNames.contains(name)) {
    return
  }

  store.createIndex(name, keyPath, { unique: false })
}

function upgradeDatabase(database: IDBDatabase, transaction: IDBTransaction | null) {
  const store = database.objectStoreNames.contains(LOG_HISTORY_STORE_NAME)
    ? transaction?.objectStore(LOG_HISTORY_STORE_NAME)
    : database.createObjectStore(LOG_HISTORY_STORE_NAME, { keyPath: 'id' })

  if (!store) {
    throw new Error('Could not upgrade IndexedDB log history store.')
  }

  createIndex(store, LOG_HISTORY_TIMESTAMP_INDEX, 'timestamp')
  createIndex(store, LOG_HISTORY_CATEGORY_INDEX, 'category')
  createIndex(store, LOG_HISTORY_ACTION_INDEX, 'action')
  createIndex(store, LOG_HISTORY_PROTOCOL_INDEX, 'protocol')
}

async function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      resolve()
    })
    transaction.addEventListener('abort', () => {
      reject(getIndexedDBError(transaction.error, 'IndexedDB transaction aborted.'))
    })
    transaction.addEventListener('error', () => {
      reject(getIndexedDBError(transaction.error, 'IndexedDB transaction failed.'))
    })
  })
}

async function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result)
    })
    request.addEventListener('error', () => {
      reject(getIndexedDBError(request.error, 'IndexedDB request failed.'))
    })
  })
}

export async function openLogHistoryStore(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return null
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LOG_HISTORY_DB_NAME, LOG_HISTORY_DB_VERSION)

    request.addEventListener('upgradeneeded', () => {
      upgradeDatabase(request.result, request.transaction)
    })
    request.addEventListener('success', () => {
      resolve(request.result)
    })
    request.addEventListener('error', () => {
      reject(getIndexedDBError(request.error, 'Could not open IndexedDB log history.'))
    })
  })
}

async function withObjectStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => T | Promise<T>,
): Promise<T | undefined> {
  const database = await openLogHistoryStore()
  if (database === null) {
    return undefined
  }

  try {
    const transaction = database.transaction(LOG_HISTORY_STORE_NAME, mode)
    const store = transaction.objectStore(LOG_HISTORY_STORE_NAME)
    const result = await callback(store)
    await transactionToPromise(transaction)
    return result
  } finally {
    database.close()
  }
}

function createIndexedDBLogHistoryAdapter(): LogHistoryStoreAdapter {
  return {
    async clear() {
      await withObjectStore('readwrite', (store) => {
        store.clear()
      })
    },
    async deleteBefore(timestamp) {
      return (
        (await withObjectStore('readwrite', async (store) => {
          const index = store.index(LOG_HISTORY_TIMESTAMP_INDEX)
          const range = IDBKeyRange.upperBound(timestamp, true)
          let deletedCount = 0

          await new Promise<void>((resolve, reject) => {
            const request = index.openCursor(range)

            request.addEventListener('success', () => {
              const cursor = request.result
              if (!cursor) {
                resolve()
                return
              }

              cursor.delete()
              deletedCount += 1
              cursor.continue()
            })
            request.addEventListener('error', () => {
              reject(getIndexedDBError(request.error, 'Could not delete IndexedDB log history.'))
            })
          })

          return deletedCount
        })) ?? 0
      )
    },
    async deleteExcessRecords(maxRecords) {
      if (maxRecords <= 0) {
        await withObjectStore('readwrite', (store) => {
          store.clear()
        })
        return 0
      }

      return (
        (await withObjectStore('readwrite', async (store) => {
          const excessCount = (await requestToPromise(store.count())) - maxRecords
          if (excessCount <= 0) {
            return 0
          }

          const index = store.index(LOG_HISTORY_TIMESTAMP_INDEX)
          let deletedCount = 0

          await new Promise<void>((resolve, reject) => {
            const request = index.openCursor()

            request.addEventListener('success', () => {
              const cursor = request.result
              if (!cursor || deletedCount >= excessCount) {
                resolve()
                return
              }

              cursor.delete()
              deletedCount += 1
              cursor.continue()
            })
            request.addEventListener('error', () => {
              reject(getIndexedDBError(request.error, 'Could not prune IndexedDB log history.'))
            })
          })

          return deletedCount
        })) ?? 0
      )
    },
    async putMany(records) {
      await withObjectStore('readwrite', (store) => {
        for (const record of records) {
          store.put(record)
        }
      })
    },
    async queryRange(query) {
      return (
        (await withObjectStore('readonly', async (store) => {
          const index = store.index(LOG_HISTORY_TIMESTAMP_INDEX)
          const range = createTimestampRange(query)
          const limit = query.limit ?? Number.POSITIVE_INFINITY
          const records: PersistedFirewallLogRecord[] = []

          if (limit <= 0) {
            return records
          }

          await new Promise<void>((resolve, reject) => {
            const request = index.openCursor(range, 'prev')

            request.addEventListener('success', () => {
              const cursor = request.result
              if (!cursor || records.length >= limit) {
                resolve()
                return
              }

              const value: unknown = cursor.value
              if (isPersistedFirewallLogRecord(value)) {
                records.push(value)
              }
              cursor.continue()
            })
            request.addEventListener('error', () => {
              reject(getIndexedDBError(request.error, 'Could not query IndexedDB log history.'))
            })
          })

          return records
        })) ?? []
      )
    },
  }
}

const logHistoryStore = createLogHistoryStore(createIndexedDBLogHistoryAdapter())

export const appendLogHistoryBatch = logHistoryStore.appendLogHistoryBatch
export const clearLogHistory = logHistoryStore.clearLogHistory
export const deleteLogHistoryBefore = logHistoryStore.deleteLogHistoryBefore
export const pruneLogHistory = logHistoryStore.pruneLogHistory
export const queryLogHistoryRange = logHistoryStore.queryLogHistoryRange
