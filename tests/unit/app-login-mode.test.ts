import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'

import { createEvent } from 'h3'
import type { H3Event } from 'h3'

const validOidcEnvironment = {
  NUXT_OIDC_AUTH_SESSION_SECRET: 'a'.repeat(32),
  NUXT_OIDC_SESSION_SECRET: 's'.repeat(48),
  NUXT_OIDC_TOKEN_KEY: Buffer.alloc(32).toString('base64'),
}

const managedRuntimeConfig = {
  eventHub: {
    connectionString:
      'Endpoint=sb://namespace.servicebus.windows.net/;SharedAccessKeyName=reader;SharedAccessKey=event-hub-secret;EntityPath=firewall-logs',
    name: '',
  },
  oidc: {
    providers: {
      entra: {
        authorizationUrl: 'https://login.example.com/authorize',
        clientId: '11111111-1111-4111-8111-111111111111',
        clientSecret: 'login-secret',
        redirectUri: 'https://app.example.com/auth/entra/callback',
        tokenUrl: 'https://login.example.com/token',
      },
    },
  },
}

let runtimeConfig: Record<string, unknown> = {}
let handler: (event: H3Event) => unknown

function isEventHandler(value: unknown): value is (event: H3Event) => unknown {
  return typeof value === 'function'
}

function createTestEvent(path: string) {
  const request = new IncomingMessage(new Socket())
  request.url = path
  const response = new ServerResponse(request)
  return createEvent(request, response)
}

beforeAll(async () => {
  for (const [key, value] of Object.entries(validOidcEnvironment)) {
    vi.stubEnv(key, value)
  }
  vi.stubGlobal('defineEventHandler', <T>(eventHandler: T) => eventHandler)
  vi.stubGlobal('useRuntimeConfig', () => runtimeConfig)
  const middlewareModule: { default: unknown } =
    await import('../../server/middleware/app-login-mode')
  if (!isEventHandler(middlewareModule.default)) {
    throw new TypeError('App login middleware has no default event handler.')
  }
  handler = middlewareModule.default
})

beforeEach(() => {
  runtimeConfig = {}
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('app login mode server guard', () => {
  it.each([
    '/auth/entra/login',
    '/auth/entra/login/',
    '/auth/entra/callback',
    '/auth/entra/callback/',
    '/auth/entra/login?returnTo=%2Flogs',
  ])('rejects exact app-login route %s in anonymous mode', (path) => {
    expect(() => handler(createTestEvent(path))).toThrow(
      expect.objectContaining({ statusCode: 403, message: 'Application login is unavailable' }),
    )
  })

  it.each(['/auth/entra/logout', '/auth/entra/login/extra', '/other/auth/entra/login'])(
    'ignores non-login route %s',
    (path) => {
      expect(handler(createTestEvent(path))).toBeUndefined()
    },
  )

  it.each(['/auth/entra/login', '/auth/entra/callback'])('allows %s in managed mode', (path) => {
    runtimeConfig = managedRuntimeConfig

    expect(handler(createTestEvent(path))).toBeUndefined()
  })

  it.each(['/auth/entra/login', '/auth/entra/callback'])(
    'returns service unavailable for %s in invalid mode',
    (path) => {
      runtimeConfig = { eventHub: { name: 'firewall-logs' } }

      expect(() => handler(createTestEvent(path))).toThrow(
        expect.objectContaining({
          statusCode: 503,
          message: 'Deployment configuration is invalid',
        }),
      )
    },
  )
})
