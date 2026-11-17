import { EventHubConsumerClient } from '@azure/event-hubs'
import type { ReceivedEventData } from '@azure/event-hubs'
import { createError, getHeader, getRequestURL, readValidatedBody, setResponseHeaders } from 'h3'
import type { H3Event } from 'h3'
import type { UserSession } from 'nuxt-oidc-auth/runtime/types.js'

import type { ManagedEventHubStreamRequest } from '../../shared/types/managedEventHub'
import { parseDeploymentCapabilities } from './deploymentCapabilities'
import {
  createManagedEventHubStream,
  pipeManagedEventHubStream,
  validateManagedEventHubStreamRequest,
} from './managedEventHubStream'
import type {
  ManagedEventHubClient,
  ManagedEventHubStream,
  ManagedEventHubStreamOptions,
} from './managedEventHubStream'
import { registerManagedEventHubStream } from './managedEventHubStreamRegistry'

export interface ManagedEventHubRouteClient extends ManagedEventHubClient<ReceivedEventData> {
  getPartitionIds: (options: { abortSignal: AbortSignal }) => Promise<string[]>
}

/** Receives `eventHubName` only when the connection string does not name the Event Hub itself. */
export type CreateManagedEventHubClient = (
  consumerGroup: string,
  connectionString: string,
  eventHubName?: string,
) => ManagedEventHubRouteClient

export type CreateManagedEventHubRouteStream = (
  options: ManagedEventHubStreamOptions<ReceivedEventData>,
) => ManagedEventHubStream

export interface ManagedEventHubRuntimeConfig {
  eventHub: {
    connectionString: string
    name: string
  }
}

export interface ManagedEventHubStreamRouteDependencies {
  getRuntimeConfig: (event: H3Event) => ManagedEventHubRuntimeConfig
  /** Rejects when the request has no application login session. */
  requireSession: (event: H3Event) => Promise<Pick<UserSession, 'expireAt'>>
  getSessionId: (event: H3Event) => Promise<string>
  createClient?: CreateManagedEventHubClient
  createStream?: CreateManagedEventHubRouteStream
  pipeStream?: typeof pipeManagedEventHubStream
}

function createEventHubConsumerClient(
  consumerGroup: string,
  connectionString: string,
  eventHubName?: string,
): ManagedEventHubRouteClient {
  return eventHubName === undefined
    ? new EventHubConsumerClient(consumerGroup, connectionString)
    : new EventHubConsumerClient(consumerGroup, connectionString, eventHubName)
}

function hasEntityPath(connectionString: string) {
  return connectionString.split(';').some((part) => {
    const separatorIndex = part.indexOf('=')
    return separatorIndex > 0 && part.slice(0, separatorIndex).trim().toLowerCase() === 'entitypath'
  })
}

function requireSameOrigin(event: H3Event) {
  const requestUrl = getRequestURL(event)
  const origin = getHeader(event, 'origin')
  const fetchSite = getHeader(event, 'sec-fetch-site')
  if (
    origin !== requestUrl.origin ||
    (fetchSite !== undefined && fetchSite !== '' && fetchSite !== 'same-origin')
  ) {
    throw createError({ statusCode: 403, message: 'Cross-origin Event Hub stream is forbidden' })
  }
}

export function createManagedEventHubStreamHandler({
  getRuntimeConfig,
  requireSession,
  getSessionId,
  createClient = createEventHubConsumerClient,
  createStream = createManagedEventHubStream,
  pipeStream = pipeManagedEventHubStream,
}: ManagedEventHubStreamRouteDependencies): (event: H3Event) => Promise<void> {
  return async (event) => {
    const controller = new AbortController()
    const abort = () => {
      controller.abort()
    }
    event.node.req.once('aborted', abort)
    event.node.res.once('close', abort)
    event.web?.request?.signal.addEventListener('abort', abort, { once: true })
    if (
      // oxlint-disable-next-line typescript/no-deprecated -- pairs with the 'aborted' listener above; tests/unit/event-hub-stream-route.test.ts simulates an aborted request through this flag.
      event.node.req.aborted ||
      event.node.res.destroyed ||
      event.node.res.writableEnded ||
      event.web?.request?.signal.aborted === true
    ) {
      abort()
    }

    const removeAbortListeners = () => {
      event.node.req.off('aborted', abort)
      event.node.res.off('close', abort)
      event.web?.request?.signal.removeEventListener('abort', abort)
    }
    let client: ManagedEventHubRouteClient | undefined
    let managedStream: ManagedEventHubStream | undefined
    let unregisterStream: (() => void) | undefined
    let resolveCompletion!: () => void
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve
    })

    try {
      const session = await requireSession(event)
      const runtimeConfig = getRuntimeConfig(event)
      const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env)
      if (capabilities.mode !== 'managed' || !capabilities.eventHubAvailable) {
        throw createError({
          statusCode: capabilities.mode === 'invalid' ? 503 : 403,
          message: 'Managed Event Hub is unavailable',
        })
      }

      requireSameOrigin(event)
      const request = await readValidatedBody<ManagedEventHubStreamRequest>(event, (body) =>
        validateManagedEventHubStreamRequest(body) ? body : false,
      )
      const sessionId = await getSessionId(event)
      unregisterStream = await registerManagedEventHubStream(sessionId, async () => {
        controller.abort()
        await completion
      })
      const connectionString = runtimeConfig.eventHub.connectionString.trim()
      const eventHubName = runtimeConfig.eventHub.name.trim()
      try {
        client =
          eventHubName && !hasEntityPath(connectionString)
            ? createClient(request.consumerGroup, connectionString, eventHubName)
            : createClient(request.consumerGroup, connectionString)
      } catch {
        throw createError({ statusCode: 502, message: 'Managed Event Hub could not start' })
      }
      const sessionExpiresAt =
        typeof session.expireAt === 'number'
          ? session.expireAt
          : Math.floor(Date.now() / 1_000) + 60

      let expectedPartitionIds: string[]
      try {
        controller.signal.throwIfAborted()
        expectedPartitionIds = await client.getPartitionIds({ abortSignal: controller.signal })
        controller.signal.throwIfAborted()
        if (expectedPartitionIds.length === 0) {
          throw new Error('Managed Event Hub partitions unavailable')
        }
      } catch {
        throw createError({ statusCode: 502, message: 'Managed Event Hub could not start' })
      }

      managedStream = createStream({
        client,
        expectedPartitionIds,
        request,
        sessionExpiresAt,
        signal: controller.signal,
        revalidateSession: async () => {
          try {
            await requireSession(event)
            return true
          } catch {
            return false
          }
        },
      })

      setResponseHeaders(event, {
        'cache-control': 'no-cache, no-store, no-transform',
        'content-type': 'application/x-ndjson; charset=utf-8',
        'x-accel-buffering': 'no',
      })

      try {
        // oxlint-disable-next-line eslint/no-underscore-dangle -- h3 internal flag that stops h3 from writing its own response after we pipe the stream.
        event._handled = true
        await pipeStream(event.node.res, managedStream.stream)
      } catch {
        if (!event.node.res.destroyed) {
          event.node.res.destroy()
        }
      }
    } finally {
      controller.abort()
      try {
        if (managedStream) {
          await managedStream.cleanup()
        } else if (client) {
          await Promise.allSettled([client.close()])
        }
      } finally {
        unregisterStream?.()
        removeAbortListeners()
        resolveCompletion()
      }
    }
  }
}
