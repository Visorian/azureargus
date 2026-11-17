import type { ManagedEventHubStreamEnvelope } from '#shared/types/managedEventHub'
import { isJsonObject } from '#shared/utils/json'

export function parseManagedEventHubEnvelope(value: string): ManagedEventHubStreamEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('Managed Event Hub stream returned invalid JSON')
  }

  if (!isJsonObject(parsed) || typeof parsed['type'] !== 'string') {
    throw new Error('Managed Event Hub stream returned invalid message')
  }
  if (parsed['type'] === 'heartbeat') {
    return { type: 'heartbeat' }
  }
  if (parsed['type'] === 'caught-up') {
    return { type: 'caught-up' }
  }
  if (
    parsed['type'] === 'error' &&
    (parsed['message'] === 'Event Hub receiver error' || parsed['message'] === 'Session expired')
  ) {
    return { type: 'error', message: parsed['message'] }
  }
  if (parsed['type'] === 'events' && Array.isArray(parsed['events'])) {
    const events = parsed['events'].map((event) => {
      if (
        !isJsonObject(event) ||
        typeof event['enqueuedTimeUtc'] !== 'string' ||
        typeof event['partitionId'] !== 'string' ||
        typeof event['sequenceNumber'] !== 'number' ||
        (event['offset'] !== undefined && typeof event['offset'] !== 'string') ||
        (event['applicationProperties'] !== undefined &&
          !isJsonObject(event['applicationProperties']))
      ) {
        throw new Error('Managed Event Hub stream returned invalid event')
      }
      return {
        body: event['body'],
        enqueuedTimeUtc: event['enqueuedTimeUtc'],
        offset: event['offset'],
        partitionId: event['partitionId'],
        sequenceNumber: event['sequenceNumber'],
        applicationProperties: event['applicationProperties'],
      }
    })
    return { type: 'events', events }
  }

  throw new Error('Managed Event Hub stream returned unknown message')
}

export async function consumeManagedEventHubStream(
  stream: ReadableStream<Uint8Array>,
  onEnvelope: (envelope: ManagedEventHubStreamEnvelope) => void | Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  const cancel = () => void reader.cancel()
  signal.addEventListener('abort', cancel, { once: true })

  // Lines are delivered one at a time, in order, each after the previous handler settles.
  async function emitBufferedLines(): Promise<void> {
    const newlineIndex = buffered.indexOf('\n')
    if (newlineIndex === -1) {
      return
    }
    const line = buffered.slice(0, newlineIndex).trim()
    buffered = buffered.slice(newlineIndex + 1)
    if (line !== '') {
      await onEnvelope(parseManagedEventHubEnvelope(line))
    }
    await emitBufferedLines()
  }

  async function readChunk(): Promise<boolean> {
    const { done, value } = await reader.read()
    if (done) {
      return false
    }
    buffered += decoder.decode(value, { stream: true })
    await emitBufferedLines()
    return true
  }

  // The stream can stay open for hours. Each step starts the next one and finishes instead of
  // awaiting it, so completed steps are released rather than chained until the stream ends.
  function readUntilDone(resolve: () => void, reject: (error: unknown) => void): void {
    void (async () => {
      try {
        if (signal.aborted || !(await readChunk())) {
          resolve()
          return
        }
      } catch (error: unknown) {
        reject(error)
        return
      }
      readUntilDone(resolve, reject)
    })()
  }

  try {
    await new Promise<void>((resolve, reject) => {
      readUntilDone(resolve, reject)
    })

    buffered += decoder.decode()
    if (!signal.aborted && buffered.trim() !== '') {
      await onEnvelope(parseManagedEventHubEnvelope(buffered.trim()))
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
}
