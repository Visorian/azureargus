import type { ServerResponse } from 'node:http'

import type { EventPosition, ReceivedEventData } from '@azure/event-hubs'

import { MANAGED_EVENT_HUB_LOOKBACK_MINUTES } from '../../shared/types/managedEventHub'
import type {
  ManagedEventHubStreamEnvelope,
  ManagedEventHubStreamRequest,
} from '../../shared/types/managedEventHub'

type ManagedEventHubReceivedEvent = Pick<
  ReceivedEventData,
  'body' | 'enqueuedTimeUtc' | 'sequenceNumber' | 'properties'
> &
  Partial<Pick<ReceivedEventData, 'offset'>>

export interface ManagedEventHubClient {
  close(): Promise<void>
  subscribe(
    handlers: {
      processEvents(
        events: readonly ManagedEventHubReceivedEvent[],
        context: {
          partitionId: string
          updateCheckpoint(event: ManagedEventHubReceivedEvent): Promise<void>
        },
      ): Promise<void>
      processError(error: unknown): Promise<void>
    },
    options: {
      maxBatchSize: number
      maxWaitTimeInSeconds: number
      startPosition: EventPosition | Record<string, EventPosition>
    },
  ): ManagedEventHubSubscription
}

export interface ManagedEventHubSubscription {
  close(): Promise<void>
}

interface ManagedEventHubStreamOptions {
  client: ManagedEventHubClient
  expectedPartitionIds: readonly string[]
  request: ManagedEventHubStreamRequest
  sessionExpiresAt: number
  revalidateSession: () => Promise<boolean>
  signal?: AbortSignal
  heartbeatIntervalMs?: number
  sessionCheckIntervalMs?: number
  now?: () => number
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const partitionIdPattern = /^(0|[1-9]\d*)$/
const STREAM_BUFFER_HIGH_WATER_MARK = 256 * 1024
const EVENT_HUB_MAX_BATCH_SIZE = 50
const EVENT_HUB_MAX_WAIT_TIME_SECONDS = 2

function normalizeEventBodyForStream(body: unknown) {
  return body instanceof Uint8Array ? textDecoder.decode(body) : body
}

function containsControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.codePointAt(index)
    if (code !== undefined && (code <= 31 || code === 127)) {
      return true
    }
  }
  return false
}

// The caller of a write observes its failure; the chain only orders later writes.
async function settled(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
  } catch {
    // Intentionally ignored, see above.
  }
}

async function waitForResponseDrain(response: ServerResponse) {
  return new Promise<void>((resolve, reject) => {
    function cleanup() {
      response.off('close', onClose)
      response.off('drain', onDrain)
      response.off('error', onError)
    }
    function onClose() {
      cleanup()
      reject(new Error('Managed Event Hub response closed'))
    }
    function onDrain() {
      cleanup()
      resolve()
    }
    function onError(error: Error) {
      cleanup()
      reject(error)
    }

    response.once('close', onClose)
    response.once('drain', onDrain)
    response.once('error', onError)
  })
}

export async function pipeManagedEventHubStream(
  response: ServerResponse,
  stream: ReadableStream<Uint8Array>,
) {
  const reader = stream.getReader()
  try {
    while (!response.destroyed && !response.writableEnded) {
      const { done, value } = await reader.read()
      if (done) {
        break
      }
      if (!response.write(value)) {
        await waitForResponseDrain(response)
      }
    }
  } finally {
    reader.releaseLock()
  }

  if (!response.destroyed && !response.writableEnded) {
    response.end()
  }
}

export function validateManagedEventHubStreamRequest(
  value: unknown,
): value is ManagedEventHubStreamRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const keys = Object.keys(value)
  if (
    !keys.includes('consumerGroup') ||
    !keys.includes('lookbackMinutes') ||
    keys.some((key) => !['consumerGroup', 'lookbackMinutes', 'resumeFrom'].includes(key))
  ) {
    return false
  }

  const consumerGroup = 'consumerGroup' in value ? value.consumerGroup : undefined
  const lookbackMinutes = 'lookbackMinutes' in value ? value.lookbackMinutes : undefined
  const resumeFrom = 'resumeFrom' in value ? value.resumeFrom : undefined
  if (
    !(
      typeof consumerGroup === 'string' &&
      consumerGroup === consumerGroup.trim() &&
      consumerGroup.length > 0 &&
      consumerGroup.length <= 256 &&
      !containsControlCharacter(consumerGroup) &&
      MANAGED_EVENT_HUB_LOOKBACK_MINUTES.some((minutes) => minutes === lookbackMinutes)
    )
  ) {
    return false
  }

  if (resumeFrom === undefined) {
    return true
  }
  if (typeof resumeFrom !== 'object' || resumeFrom === null || Array.isArray(resumeFrom)) {
    return false
  }

  return Object.entries(resumeFrom).every(
    ([partitionId, sequenceNumber]) =>
      partitionIdPattern.test(partitionId) &&
      typeof sequenceNumber === 'number' &&
      Number.isSafeInteger(sequenceNumber) &&
      sequenceNumber >= 0,
  )
}

function createStartPosition(
  expectedPartitionIds: readonly string[],
  request: ManagedEventHubStreamRequest,
  now: () => number,
): EventPosition | Record<string, EventPosition> {
  const lookbackPosition = {
    enqueuedOn: new Date(now() - request.lookbackMinutes * 60_000),
  }
  if (!request.resumeFrom) {
    return lookbackPosition
  }

  return Object.fromEntries(
    expectedPartitionIds.map((partitionId) => {
      const sequenceNumber = request.resumeFrom?.[partitionId]
      return [
        partitionId,
        sequenceNumber === undefined ? lookbackPosition : { sequenceNumber, isInclusive: false },
      ]
    }),
  )
}

export function encodeManagedEventHubEnvelope(envelope: ManagedEventHubStreamEnvelope) {
  return textEncoder.encode(`${JSON.stringify(envelope)}\n`)
}

export function createManagedEventHubStream({
  client,
  expectedPartitionIds,
  request,
  sessionExpiresAt,
  revalidateSession,
  signal,
  heartbeatIntervalMs = 15_000,
  sessionCheckIntervalMs = 30_000,
  now = Date.now,
}: ManagedEventHubStreamOptions) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let subscription: ManagedEventHubSubscription | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let sessionTimer: ReturnType<typeof setInterval> | null = null
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  let demandResolve: (() => void) | null = null
  let closed = false
  let cleanupPromise: Promise<void> | null = null
  let writeChain = Promise.resolve()
  let heartbeatPending = false
  let sessionCheckPending = false
  const pendingCatchUpPartitions = new Set(expectedPartitionIds)
  const checkpointSequenceNumbers = new Map<string, number>()
  let caughtUpWritten = false

  const releaseDemand = () => {
    demandResolve?.()
    demandResolve = null
  }

  const lacksDemand = () =>
    !closed && controller?.desiredSize !== null && (controller?.desiredSize ?? 0) <= 0

  const nextDemand = async () =>
    new Promise<void>((resolve) => {
      demandResolve = resolve
    })

  const waitForDemand = async () => {
    while (lacksDemand()) {
      await nextDemand()
    }
  }

  const cleanup = async () => {
    if (cleanupPromise) {
      return cleanupPromise
    }

    closed = true
    releaseDemand()
    signal?.removeEventListener('abort', onAbort)
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
    }
    if (sessionTimer) {
      clearInterval(sessionTimer)
    }
    if (expiryTimer) {
      clearTimeout(expiryTimer)
    }

    const activeSubscription = subscription
    subscription = null
    cleanupPromise = (async () => {
      await Promise.allSettled([activeSubscription?.close(), client.close()])
      try {
        controller?.close()
      } catch {
        // Stream may already be cancelled by its consumer.
      }
    })()
    return cleanupPromise
  }

  // cleanup() never rejects: client closes are settled and controller.close() is guarded.
  function onAbort() {
    void cleanup()
  }

  const enqueueAfter = async (
    previousWrite: Promise<void>,
    encoded: Uint8Array,
    waitForBackpressure: boolean,
  ) => {
    await previousWrite
    if (closed || !controller) {
      throw new Error('Managed Event Hub stream is closed')
    }
    controller.enqueue(encoded)
    if (waitForBackpressure) {
      await waitForDemand()
    }
  }

  const write = async (envelope: ManagedEventHubStreamEnvelope, waitForBackpressure = true) => {
    const encoded = encodeManagedEventHubEnvelope(envelope)
    const pendingWrite = enqueueAfter(writeChain, encoded, waitForBackpressure)
    writeChain = settled(pendingWrite)
    return pendingWrite
  }

  const sendHeartbeat = async () => {
    try {
      await write({ type: 'heartbeat' })
    } catch {
      await cleanup()
    } finally {
      heartbeatPending = false
    }
  }

  const terminateForExpiredSession = async () => {
    if (closed) {
      return
    }
    try {
      controller?.enqueue(
        encodeManagedEventHubEnvelope({ type: 'error', message: 'Session expired' }),
      )
    } catch {
      // Consumer closure is handled by cleanup.
    }
    await cleanup()
  }

  const checkSession = async () => {
    try {
      if (!(await revalidateSession())) {
        await terminateForExpiredSession()
      }
    } catch {
      await terminateForExpiredSession()
    } finally {
      sessionCheckPending = false
    }
  }

  const reportSubscribeFailure = async () => {
    try {
      await write({ type: 'error', message: 'Event Hub receiver error' }, false)
    } finally {
      await cleanup()
    }
  }

  const stream = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController
        if (signal?.aborted) {
          void cleanup()
          return
        }
        signal?.addEventListener('abort', onAbort, { once: true })

        try {
          subscription = client.subscribe(
            {
              async processEvents(events, context) {
                if (closed) {
                  return
                }
                if (events.length === 0) {
                  if (caughtUpWritten || !pendingCatchUpPartitions.delete(context.partitionId)) {
                    return
                  }
                  if (pendingCatchUpPartitions.size === 0) {
                    caughtUpWritten = true
                    await write({ type: 'caught-up' })
                  }
                  return
                }
                await write({
                  type: 'events',
                  events: events.map((event) => ({
                    body: normalizeEventBodyForStream(event.body),
                    enqueuedTimeUtc: event.enqueuedTimeUtc.toISOString(),
                    partitionId: context.partitionId,
                    sequenceNumber: event.sequenceNumber,
                    // The SDK passes the raw AMQP x-opt-offset annotation through untyped at runtime.
                    // oxlint-disable-next-line typescript/no-unnecessary-type-conversion -- keep coercing to the string the browser parser requires
                    offset: event.offset === undefined ? undefined : String(event.offset),
                    applicationProperties: event.properties,
                  })),
                })
                const checkpointEvent = events.reduce((highest, event) =>
                  event.sequenceNumber > highest.sequenceNumber ? event : highest,
                )
                const checkpointSequenceNumber = checkpointSequenceNumbers.get(context.partitionId)
                if (
                  checkpointSequenceNumber === undefined ||
                  checkpointEvent.sequenceNumber > checkpointSequenceNumber
                ) {
                  await context.updateCheckpoint(checkpointEvent)
                  checkpointSequenceNumbers.set(context.partitionId, checkpointEvent.sequenceNumber)
                }
              },
              async processError() {
                if (closed) {
                  return
                }
                try {
                  await write({ type: 'error', message: 'Event Hub receiver error' })
                } catch {
                  await cleanup()
                }
              },
            },
            {
              maxBatchSize: EVENT_HUB_MAX_BATCH_SIZE,
              maxWaitTimeInSeconds: EVENT_HUB_MAX_WAIT_TIME_SECONDS,
              startPosition: createStartPosition(expectedPartitionIds, request, now),
            },
          )
        } catch {
          void reportSubscribeFailure()
          return
        }

        heartbeatTimer = setInterval(() => {
          if (heartbeatPending) {
            return
          }
          heartbeatPending = true
          void sendHeartbeat()
        }, heartbeatIntervalMs)
        sessionTimer = setInterval(() => {
          if (sessionCheckPending) {
            return
          }
          sessionCheckPending = true
          void checkSession()
        }, sessionCheckIntervalMs)
        expiryTimer = setTimeout(
          () => void terminateForExpiredSession(),
          Math.max(0, sessionExpiresAt * 1_000 - now()),
        )
      },
      pull() {
        releaseDemand()
      },
      async cancel() {
        await cleanup()
      },
    },
    new ByteLengthQueuingStrategy({ highWaterMark: STREAM_BUFFER_HIGH_WATER_MARK }),
  )

  return { cleanup, stream }
}
