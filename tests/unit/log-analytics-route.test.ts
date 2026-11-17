import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import type { H3Event } from 'h3'

import type { LogAnalyticsAccessTokenProvider } from '../../server/utils/logAnalyticsAuth'
import { createLogAnalyticsQueryHandler } from '../../server/utils/managedLogAnalyticsHandlers'
import type {
  LogAnalyticsQueryRouteDependencies,
  ManagedLogAnalyticsRuntimeConfig,
} from '../../server/utils/managedLogAnalyticsHandlers'
import type { LogAnalyticsQueryRequest } from '../../shared/types/logAnalytics'
import { LogAnalyticsQueryError } from '../../shared/utils/logAnalyticsQuery'

type ExecuteQuery = NonNullable<LogAnalyticsQueryRouteDependencies['executeQuery']>

const config = {
  tenantId: '11111111-1111-1111-1111-111111111111',
  clientId: '22222222-2222-2222-2222-222222222222',
  clientSecret: 'secret',
  workspaceId: '33333333-3333-3333-3333-333333333333',
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
const anonymousLogAnalytics = { tenantId: '', clientId: '', clientSecret: '', workspaceId: '' }
let runtimeConfig: ManagedLogAnalyticsRuntimeConfig & { oidc?: typeof oidc }
const requireSession = vi.fn<(event: H3Event) => Promise<unknown>>()
const getAccessToken = vi.fn<LogAnalyticsAccessTokenProvider>()
const executeLogAnalyticsQuery = vi.fn<ExecuteQuery>()
const handler = createLogAnalyticsQueryHandler({
  executeQuery: executeLogAnalyticsQuery,
  getAccessToken,
  getRuntimeConfig: () => runtimeConfig,
  requireSession,
})
const anyAbortSignal: unknown = expect.any(AbortSignal)

function createRequest(): LogAnalyticsQueryRequest {
  return {
    filters: {
      action: '',
      category: [],
      destination: '',
      destinationPort: '',
      protocol: '',
      search: '',
      source: '',
      sourcePort: '',
    },
    from: '2026-07-10T10:00:00.000Z',
    limit: 1_000,
    storage: 'resource-specific',
    sort: { direction: 'desc', key: 'timestamp' },
    to: '2026-07-10T10:15:00.000Z',
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
  runtimeConfig = { logAnalytics: config, oidc }
  requireSession.mockReset().mockResolvedValue({
    provider: 'entra',
    canRefresh: false,
    expireAt: 1_800_000_000,
    claims: { tid: 'independent-login-tenant', roles: ['Unrelated.Login.Role'] },
  })
  getAccessToken.mockReset().mockResolvedValue('access-token')
  executeLogAnalyticsQuery.mockReset().mockResolvedValue({
    limit: 1_000,
    records: [],
    truncated: false,
  })
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('Log Analytics query route authentication', () => {
  it('requires a login session before reading private configuration', async () => {
    runtimeConfig = { logAnalytics: { ...config, clientSecret: '' }, oidc }
    requireSession.mockRejectedValue({ statusCode: 401 })

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 401 })
    expect(getAccessToken).not.toHaveBeenCalled()
  })

  it('returns 503 when independent service-principal configuration is incomplete', async () => {
    runtimeConfig = { logAnalytics: { ...config, clientSecret: '' }, oidc }

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 503 })
  })

  it('uses service-principal configuration without comparing login claims', async () => {
    const request = createRequest()

    await expect(handler(createTestEvent(request))).resolves.toStrictEqual({
      limit: 1_000,
      records: [],
      truncated: false,
    })
    expect(getAccessToken).toHaveBeenCalledOnce()
    expect(executeLogAnalyticsQuery).toHaveBeenCalledWith(
      config,
      request,
      'access-token',
      expect.objectContaining({ signal: anyAbortSignal }),
    )
  })

  it('rejects the managed route in anonymous deployments', async () => {
    runtimeConfig = { logAnalytics: anonymousLogAnalytics }

    await expect(handler(createTestEvent(createRequest()))).rejects.toMatchObject({
      statusCode: 403,
    })
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(executeLogAnalyticsQuery).not.toHaveBeenCalled()
  })

  it('rejects an invalid request before contacting Azure', async () => {
    await expect(
      handler(createTestEvent({ ...createRequest(), workspaceId: 'caller-controlled' })),
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(getAccessToken).not.toHaveBeenCalled()
    expect(executeLogAnalyticsQuery).not.toHaveBeenCalled()
  })

  it.each([
    [new LogAnalyticsQueryError('throttled', 30), 429],
    [new LogAnalyticsQueryError('timeout'), 504],
    [new LogAnalyticsQueryError('upstream'), 502],
  ])('maps Azure query failures to the expected HTTP status', async (error, statusCode) => {
    executeLogAnalyticsQuery.mockRejectedValueOnce(error)
    const event = createTestEvent(createRequest())

    await expect(handler(event)).rejects.toMatchObject({ statusCode })
    expect(event.node.res.getHeader('retry-after')).toBe(statusCode === 429 ? 30 : undefined)
  })
})
