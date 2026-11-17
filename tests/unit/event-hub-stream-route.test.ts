import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'

import type { pipeManagedEventHubStream } from '../../server/utils/managedEventHubStream'
import { createManagedEventHubStreamHandler } from '../../server/utils/managedEventHubStreamHandler'
import type {
  CreateManagedEventHubClient,
  CreateManagedEventHubRouteStream,
  ManagedEventHubRouteClient,
  ManagedEventHubRuntimeConfig,
  ManagedEventHubStreamRouteDependencies,
} from '../../server/utils/managedEventHubStreamHandler'

const runtimeConfig = {
  eventHub: {
    connectionString:
      'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=private-secret;EntityPath=firewall-logs',
    name: '',
  },
  oidc: {
    providers: {
      entra: {
        authorizationUrl: 'https://login.example.com/authorize',
        clientId: '44444444-4444-4444-8444-444444444444',
        clientSecret: 'login-secret',
        redirectUri: 'https://app.example.com/auth/callback',
        tokenUrl: 'https://login.example.com/token',
      },
    },
  },
}
let currentRuntimeConfig: ManagedEventHubRuntimeConfig & { oidc?: typeof runtimeConfig.oidc } =
  runtimeConfig
const getRuntimeConfig = vi.fn<ManagedEventHubStreamRouteDependencies['getRuntimeConfig']>(
  () => currentRuntimeConfig,
)
const requireSession = vi.fn<ManagedEventHubStreamRouteDependencies['requireSession']>()
const getSessionId = vi.fn<ManagedEventHubStreamRouteDependencies['getSessionId']>()
const createClient = vi.fn<CreateManagedEventHubClient>()
const createStream = vi.fn<CreateManagedEventHubRouteStream>()
const pipeStream = vi.fn<typeof pipeManagedEventHubStream>()
const handler = createManagedEventHubStreamHandler({
  createClient,
  createStream,
  getRuntimeConfig,
  getSessionId,
  pipeStream,
  requireSession,
})
const anyAbortSignal: unknown = expect.any(AbortSignal)

function installAzureClientMock(getPartitionIds: ManagedEventHubRouteClient['getPartitionIds']) {
  const client = {
    close: vi.fn<ManagedEventHubRouteClient['close']>(async () => {}),
    getPartitionIds: vi.fn<ManagedEventHubRouteClient['getPartitionIds']>(getPartitionIds),
    subscribe: vi.fn<ManagedEventHubRouteClient['subscribe']>(),
  }
  createClient.mockReturnValue(client)
  return client
}

function createTestEvent(body?: unknown, headers: Record<string, string> = {}) {
  const request = new IncomingMessage(new Socket())
  const response = new ServerResponse(request)
  request.method = 'POST'
  request.headers.host = 'app.example.com'
  Object.assign(request.headers, {
    origin: 'http://app.example.com',
    'sec-fetch-site': 'same-origin',
    ...headers,
  })
  if (body !== undefined) {
    const payload = JSON.stringify(body)
    request.headers['content-length'] = String(Buffer.byteLength(payload))
    request.headers['content-type'] = 'application/json'
    request.push(payload)
    request.push(null)
    request.complete = true
  }
  return createEvent(request, response)
}

beforeAll(() => {
  vi.stubEnv('NUXT_OIDC_AUTH_SESSION_SECRET', 's'.repeat(48))
  vi.stubEnv('NUXT_OIDC_SESSION_SECRET', 's'.repeat(48))
  vi.stubEnv('NUXT_OIDC_TOKEN_KEY', Buffer.alloc(32).toString('base64'))
})

beforeEach(() => {
  currentRuntimeConfig = runtimeConfig
  getRuntimeConfig.mockClear()
  requireSession.mockReset().mockResolvedValue({ expireAt: 1_800_000_000 })
  getSessionId.mockReset().mockResolvedValue('default-session')
  createClient.mockReset()
  createStream.mockReset()
  pipeStream.mockReset().mockResolvedValue(undefined)
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('managed Event Hub stream route', () => {
  it('requires a session before reading deployment configuration', async () => {
    requireSession.mockRejectedValueOnce({ statusCode: 401 })

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 401 })
    expect(getRuntimeConfig).not.toHaveBeenCalled()
    expect(getSessionId).not.toHaveBeenCalled()
    expect(createClient).not.toHaveBeenCalled()
    expect(createStream).not.toHaveBeenCalled()
  })

  it('supersedes the previous stream for the same OIDC session', async () => {
    const cleanups: ReturnType<typeof vi.fn<() => Promise<void>>>[] = []
    createStream.mockImplementation(({ signal }) => {
      let streamController: ReadableStreamDefaultController<Uint8Array>
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller
          signal?.addEventListener(
            'abort',
            () => {
              controller.close()
            },
            { once: true },
          )
        },
      })
      const cleanup = vi.fn<() => Promise<void>>(async () => {
        try {
          streamController.close()
        } catch {
          // The abort listener may have closed it already.
        }
      })
      cleanups.push(cleanup)
      return { cleanup, stream }
    })
    pipeStream.mockImplementation(async (response, stream) => {
      await stream.getReader().read()
      response.end()
    })
    installAzureClientMock(async () => ['0'])
    const firstEvent = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    const secondEvent = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })

    const first = handler(firstEvent)
    await vi.waitFor(() => {
      expect(createStream).toHaveBeenCalledOnce()
    })
    const second = handler(secondEvent)
    await vi.waitFor(() => {
      expect(createStream).toHaveBeenCalledTimes(2)
    })
    await expect(first).resolves.toBeUndefined()
    expect(firstEvent.node.res.writableEnded).toBe(true)
    expect(cleanups[0]).toHaveBeenCalledOnce()

    secondEvent.node.req.emit('aborted')
    await expect(second).resolves.toBeUndefined()
  })

  it('keeps streams from different OIDC sessions active', async () => {
    getSessionId.mockResolvedValueOnce('first-session').mockResolvedValueOnce('second-session')
    createStream.mockImplementation(({ signal }) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            'abort',
            () => {
              controller.close()
            },
            { once: true },
          )
        },
      })
      return { cleanup: vi.fn<() => Promise<void>>(async () => {}), stream }
    })
    pipeStream.mockImplementation(async (_response, stream) => {
      await stream.getReader().read()
    })
    installAzureClientMock(async () => ['0'])
    const firstEvent = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    const secondEvent = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })

    const first = handler(firstEvent)
    const second = handler(secondEvent)
    await vi.waitFor(() => {
      expect(createStream).toHaveBeenCalledTimes(2)
    })
    expect(firstEvent.node.res.writableEnded).toBe(false)
    expect(secondEvent.node.res.writableEnded).toBe(false)

    firstEvent.node.req.emit('aborted')
    secondEvent.node.req.emit('aborted')
    await Promise.all([first, second])
  })

  it('rejects deployments without managed Event Hub capability', async () => {
    currentRuntimeConfig = { eventHub: { connectionString: '', name: '' } }

    await expect(
      handler(createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })),
    ).rejects.toMatchObject({ statusCode: 403 })
    expect(createClient).not.toHaveBeenCalled()
    expect(createStream).not.toHaveBeenCalled()
  })

  it.each([
    [
      'cross-origin requests',
      { consumerGroup: '$Default', lookbackMinutes: 5 },
      { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' },
      403,
    ],
    ['invalid request DTOs', { consumerGroup: '$Default', lookbackMinutes: 30 }, {}, 400],
    [
      'invalid resume positions',
      {
        consumerGroup: '$Default',
        lookbackMinutes: 5,
        resumeFrom: { '0': -1 },
      },
      {},
      400,
    ],
    [
      'request DTOs containing credentials',
      { consumerGroup: '$Default', lookbackMinutes: 5, connectionString: 'caller-secret' },
      {},
      400,
    ],
  ])('rejects %s before constructing an Azure client', async (_name, body, headers, statusCode) => {
    await expect(handler(createTestEvent(body, headers))).rejects.toMatchObject({ statusCode })
    expect(createClient).not.toHaveBeenCalled()
    expect(createStream).not.toHaveBeenCalled()
  })

  it('rejects requests without an Origin header before constructing an Azure client', async () => {
    const event = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    event.node.req.headers.origin = undefined

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('sanitizes Azure client construction failures', async () => {
    createClient.mockImplementationOnce(() => {
      throw new Error(`Could not use ${runtimeConfig.eventHub.connectionString}`)
    })

    await expect(
      handler(createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })),
    ).rejects.toMatchObject({
      message: 'Managed Event Hub could not start',
      statusCode: 502,
    })
  })

  it.each([
    ['no partitions', async () => [] as string[]],
    [
      'partition discovery failure',
      async () => {
        throw new Error('private-secret')
      },
    ],
  ])('cleans up and sanitizes %s', async (_name, getPartitionIds) => {
    const client = installAzureClientMock(getPartitionIds)
    const event = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    const initialRequestAbortListeners = event.node.req.listenerCount('aborted')
    const initialResponseCloseListeners = event.node.res.listenerCount('close')

    await expect(handler(event)).rejects.toMatchObject({
      message: 'Managed Event Hub could not start',
      statusCode: 502,
    })

    expect(client.getPartitionIds).toHaveBeenCalledWith({
      abortSignal: anyAbortSignal,
    })
    expect(client.close).toHaveBeenCalledOnce()
    expect(createStream).not.toHaveBeenCalled()
    expect(pipeStream).not.toHaveBeenCalled()
    expect(event.node.req.listenerCount('aborted')).toBe(initialRequestAbortListeners)
    expect(event.node.res.listenerCount('close')).toBe(initialResponseCloseListeners)
  })

  it('closes the client without starting discovery after the request already aborted', async () => {
    const client = installAzureClientMock(async () => ['0'])
    const event = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    Object.defineProperty(event.node.req, 'aborted', { value: true })

    await expect(handler(event)).rejects.toMatchObject({
      message: 'Managed Event Hub could not start',
      statusCode: 502,
    })

    expect(client.getPartitionIds).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalledOnce()
    expect(createStream).not.toHaveBeenCalled()
  })

  it('closes the client without starting discovery after the response already ended', async () => {
    const client = installAzureClientMock(async () => ['0'])
    const event = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    event.node.res.end()

    await expect(handler(event)).rejects.toMatchObject({
      message: 'Managed Event Hub could not start',
      statusCode: 502,
    })

    expect(client.getPartitionIds).not.toHaveBeenCalled()
    expect(client.close).toHaveBeenCalledOnce()
    expect(createStream).not.toHaveBeenCalled()
  })

  it('aborts partition discovery when the request closes', async () => {
    let discoveryAborted = false
    const client = installAzureClientMock(
      async (options) =>
        await new Promise<string[]>((_resolve, reject) => {
          const { abortSignal } = options
          abortSignal.addEventListener(
            'abort',
            () => {
              discoveryAborted = abortSignal.aborted
              reject(new Error('aborted'))
            },
            { once: true },
          )
        }),
    )
    const event = createTestEvent({ consumerGroup: '$Default', lookbackMinutes: 5 })
    const handling = handler(event)
    await vi.waitFor(() => {
      expect(client.getPartitionIds).toHaveBeenCalledOnce()
    })

    event.node.req.emit('aborted')

    await expect(handling).rejects.toMatchObject({
      message: 'Managed Event Hub could not start',
      statusCode: 502,
    })
    expect(discoveryAborted).toBe(true)
    expect(client.close).toHaveBeenCalledOnce()
    expect(createStream).not.toHaveBeenCalled()
  })

  it.each([
    [runtimeConfig.eventHub.connectionString, '', 2],
    [
      'Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=private-secret',
      'firewall-logs',
      3,
    ],
  ])(
    'streams managed events with server-owned credentials',
    async (connectionString, eventHubName, constructorArgumentCount) => {
      currentRuntimeConfig = {
        ...runtimeConfig,
        eventHub: { connectionString, name: eventHubName },
      }
      const stream = new ReadableStream<Uint8Array>()
      const cleanup = vi.fn<() => Promise<void>>(async () => {})
      const client = installAzureClientMock(async () => ['0', '1'])
      createStream.mockReturnValue({ cleanup, stream })
      const request = {
        consumerGroup: '$Default',
        lookbackMinutes: 5,
        resumeFrom: { '0': 42 },
      } as const
      const event = createTestEvent(request)

      await handler(event)

      expect(createClient).toHaveBeenCalledOnce()
      expect(createClient.mock.calls[0]).toHaveLength(constructorArgumentCount)
      expect(createStream).toHaveBeenCalledWith(
        expect.objectContaining({
          client,
          expectedPartitionIds: ['0', '1'],
          request,
        }),
      )
      expect(client.getPartitionIds).toHaveBeenCalledWith({
        abortSignal: anyAbortSignal,
      })
      expect(pipeStream).toHaveBeenCalledWith(event.node.res, stream)
      expect(event.node.res.getHeader('content-type')).toBe('application/x-ndjson; charset=utf-8')
      expect(event.node.res.getHeader('x-accel-buffering')).toBe('no')
      expect(cleanup).toHaveBeenCalledOnce()
    },
  )
})
