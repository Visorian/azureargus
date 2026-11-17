import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import type { H3Event } from 'h3'

import type { LogAnalyticsAccessTokenProvider } from '../../server/utils/logAnalyticsAuth'
import {
  createDnsDetailHandler,
  createDnsListHandler,
  createDnsReadinessHandler,
} from '../../server/utils/managedLogAnalyticsHandlers'
import type {
  DnsDetailRouteDependencies,
  DnsListRouteDependencies,
  DnsReadinessRouteDependencies,
  ManagedLogAnalyticsRuntimeConfig,
} from '../../server/utils/managedLogAnalyticsHandlers'
import type { DnsDetailQueryRequest, DnsListQueryRequest } from '../../shared/types/dns'

const requireSession = vi.fn<(event: H3Event) => Promise<unknown>>()
const getAccessToken = vi.fn<LogAnalyticsAccessTokenProvider>()
const executeDnsDetailQuery = vi.fn<NonNullable<DnsDetailRouteDependencies['executeQuery']>>()
const executeDnsListQuery = vi.fn<NonNullable<DnsListRouteDependencies['executeQuery']>>()
const executeDnsReadinessQuery = vi.fn<NonNullable<DnsReadinessRouteDependencies['executeQuery']>>()

const managedConfig = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  clientSecret: 'secret',
  workspaceId: '33333333-3333-4333-8333-333333333333',
}
const oidc = {
  providers: {
    entra: {
      authorizationUrl: 'https://login.example.com/authorize',
      clientId: '44444444-4444-4444-8444-444444444444',
      clientSecret: 'login-secret',
      redirectUri: 'https://app.example.com/auth/callback',
      tokenUrl: 'https://login.example.com/token',
    },
  },
}
const resourceId =
  '/subscriptions/77777777-7777-4777-8777-777777777777/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub'

const anonymousLogAnalytics = { tenantId: '', clientId: '', clientSecret: '', workspaceId: '' }
let runtimeConfig: ManagedLogAnalyticsRuntimeConfig & { oidc?: typeof oidc }
const routeDependencies = {
  getAccessToken,
  getRuntimeConfig: () => runtimeConfig,
  requireSession,
}
const managedDetailHandler = createDnsDetailHandler({
  ...routeDependencies,
  executeQuery: executeDnsDetailQuery,
})
const managedListHandler = createDnsListHandler({
  ...routeDependencies,
  executeQuery: executeDnsListQuery,
})
const managedReadinessHandler = createDnsReadinessHandler({
  ...routeDependencies,
  executeQuery: executeDnsReadinessQuery,
})

const anyAbortSignal: unknown = expect.any(AbortSignal)

function createListRequest(): DnsListQueryRequest {
  return {
    from: '2026-07-10T10:00:00.000Z',
    to: '2026-07-10T10:15:00.000Z',
    filters: {
      search: '',
      queryType: '',
      client: '',
      protocol: '',
      outcome: '',
      source: '',
    },
    limit: 1_000,
    storage: 'resource-specific',
  }
}

function createManagedDetailRequest(): DnsDetailQueryRequest {
  return {
    selector: {
      source: 'proxy-structured',
      resourceId,
      timestamp: '2026-07-10T10:01:00.000Z',
      queryId: '22213',
      queryName: 'example.com.',
      clientIp: '10.0.0.4',
      clientPort: '52338',
    },
  }
}

function createTestEvent(body?: unknown) {
  const request = new IncomingMessage(new Socket())
  const response = new ServerResponse(request)
  if (body !== undefined) {
    const payload = JSON.stringify(body)
    request.method = 'POST'
    request.headers['content-length'] = String(Buffer.byteLength(payload))
    request.headers['content-type'] = 'application/json'
    request.push(payload)
    request.push(null)
  }
  return createEvent(request, response)
}

beforeAll(() => {
  vi.stubEnv('NUXT_OIDC_AUTH_SESSION_SECRET', 's'.repeat(32))
  vi.stubEnv('NUXT_OIDC_SESSION_SECRET', 's'.repeat(48))
  vi.stubEnv('NUXT_OIDC_TOKEN_KEY', Buffer.alloc(32).toString('base64'))
})

beforeEach(() => {
  runtimeConfig = { logAnalytics: managedConfig, oidc }
  requireSession.mockReset().mockResolvedValue({
    provider: 'entra',
    canRefresh: false,
    expireAt: 1_800_000_000,
    claims: { sub: 'user' },
  })
  getAccessToken.mockReset().mockResolvedValue('managed-token')
  executeDnsListQuery.mockReset().mockResolvedValue({
    queriedEntries: [],
    transportObservations: [],
    queriedEntriesTruncated: false,
    transportObservationsTruncated: false,
    sources: [],
  })
  executeDnsReadinessQuery.mockReset().mockResolvedValue({ readiness: [] })
  executeDnsDetailQuery.mockReset().mockResolvedValue({
    observations: [],
    detailTruncated: false,
    completeness: 'partial',
    warnings: [],
  })
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('managed DNS readiness route', () => {
  it('queries configured workspace immediately without caller input', async () => {
    await expect(managedReadinessHandler(createTestEvent())).resolves.toStrictEqual({
      readiness: [],
    })

    expect(getAccessToken).toHaveBeenCalledWith(managedConfig, expect.any(AbortSignal))
    expect(executeDnsReadinessQuery).toHaveBeenCalledWith(
      managedConfig,
      'managed-token',
      expect.objectContaining({ signal: anyAbortSignal }),
    )
  })
})

describe('managed DNS list route', () => {
  it('requires login before reading managed configuration', async () => {
    runtimeConfig = { logAnalytics: { ...managedConfig, clientSecret: '' }, oidc }
    requireSession.mockRejectedValueOnce({ statusCode: 401 })

    await expect(managedListHandler(createTestEvent())).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(executeDnsListQuery).not.toHaveBeenCalled()
  })

  it('uses fixed workspace credentials and propagates request cancellation', async () => {
    let querySignal: AbortSignal | undefined
    executeDnsListQuery.mockImplementationOnce(async (_target, _request, _token, options) => {
      if (!options?.signal) {
        throw new Error('Expected incoming request signal')
      }
      const signal = options.signal
      querySignal = signal
      await new Promise<void>((resolve) => {
        signal.addEventListener(
          'abort',
          () => {
            resolve()
          },
          { once: true },
        )
      })
      return {
        queriedEntries: [],
        transportObservations: [],
        queriedEntriesTruncated: false,
        transportObservationsTruncated: false,
        sources: [],
      }
    })
    const request = createListRequest()
    const event = createTestEvent(request)
    const response = managedListHandler(event)
    await vi.waitFor(() => {
      expect(executeDnsListQuery).toHaveBeenCalledOnce()
    })

    event.node.req.emit('aborted')
    await expect(response).resolves.toMatchObject({ queriedEntries: [] })

    expect(querySignal?.aborted).toBe(true)
    expect(getAccessToken).toHaveBeenCalledWith(managedConfig, expect.any(AbortSignal))
    expect(executeDnsListQuery).toHaveBeenCalledWith(
      managedConfig,
      request,
      'managed-token',
      expect.objectContaining({ signal: anyAbortSignal }),
    )
  })

  it('rejects unavailable capability and caller-controlled workspace', async () => {
    runtimeConfig = { logAnalytics: anonymousLogAnalytics }
    await expect(managedListHandler(createTestEvent(createListRequest()))).rejects.toMatchObject({
      statusCode: 403,
    })

    runtimeConfig = { logAnalytics: managedConfig, oidc }
    await expect(
      managedListHandler(
        createTestEvent({ ...createListRequest(), workspaceId: 'caller-controlled' }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      managedListHandler(createTestEvent({ ...createListRequest(), storage: 'both' })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(executeDnsListQuery).not.toHaveBeenCalled()
  })
})

describe('managed DNS detail route', () => {
  it('uses fixed workspace credentials without accepting caller workspace', async () => {
    const request = createManagedDetailRequest()

    await expect(managedDetailHandler(createTestEvent(request))).resolves.toMatchObject({
      observations: [],
    })

    expect(getAccessToken).toHaveBeenCalledWith(managedConfig, expect.any(AbortSignal))
    expect(executeDnsDetailQuery).toHaveBeenCalledWith(
      managedConfig,
      request,
      'managed-token',
      expect.objectContaining({ signal: anyAbortSignal }),
    )

    await expect(
      managedDetailHandler(createTestEvent({ ...request, workspaceId: 'caller-controlled' })),
    ).rejects.toMatchObject({ statusCode: 400 })
  })
})
