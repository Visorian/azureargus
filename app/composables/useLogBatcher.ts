export const DEFAULT_LOG_BATCH_FLUSH_INTERVAL_MS = 100

interface LogBatcherOptions<T> {
  flushIntervalMs?: number
  onFlush: (items: readonly T[]) => void
}

export interface LogBatcher<T> {
  readonly pendingCount: number
  clear: () => void
  flush: () => void
  pushMany: (items: readonly T[]) => void
}

export function createLogBatcher<T>({
  flushIntervalMs = DEFAULT_LOG_BATCH_FLUSH_INTERVAL_MS,
  onFlush,
}: LogBatcherOptions<T>): LogBatcher<T> {
  let pendingItems: T[] = []
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancelTimer() {
    if (timer === undefined) {
      return
    }

    clearTimeout(timer)
    timer = undefined
  }

  function flush() {
    cancelTimer()

    if (pendingItems.length === 0) {
      return
    }

    const items = pendingItems
    pendingItems = []
    onFlush(items)
  }

  function scheduleFlush() {
    if (timer !== undefined) {
      return
    }

    timer = setTimeout(flush, flushIntervalMs)
  }

  function pushMany(items: readonly T[]) {
    if (items.length === 0) {
      return
    }

    pendingItems.push(...items)
    scheduleFlush()
  }

  function clear() {
    cancelTimer()
    pendingItems = []
  }

  return {
    get pendingCount(): number {
      return pendingItems.length
    },
    clear,
    flush,
    pushMany,
  }
}
