import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { fileURLToPath } from 'node:url'

import { createEvent } from 'h3'
import type { H3Event } from 'h3'

const databasePath = fileURLToPath(
  new URL('../fixtures/GeoLite2-Country-Test.mmdb', import.meta.url),
)
let handler: (event: H3Event) => Promise<unknown>

function isEventHandler(value: unknown): value is (event: H3Event) => Promise<unknown> {
  return typeof value === 'function'
}

function createTestEvent(body: unknown) {
  const request = new IncomingMessage(new Socket())
  const response = new ServerResponse(request)
  const payload = JSON.stringify(body)
  request.method = 'POST'
  request.headers['content-length'] = String(Buffer.byteLength(payload))
  request.headers['content-type'] = 'application/json'
  request.push(payload)
  request.push(null)
  return createEvent(request, response)
}

beforeAll(async () => {
  vi.stubGlobal('defineEventHandler', <T>(eventHandler: T) => eventHandler)
  vi.stubGlobal('useRuntimeConfig', () => ({ ipCountry: { databasePath } }))
  const routeModule: { default: unknown } = await import('../../server/api/ip-country.post')
  if (!isEventHandler(routeModule.default)) {
    throw new TypeError('IP country route has no default event handler.')
  }
  handler = routeModule.default
})

afterAll(() => {
  vi.unstubAllGlobals()
})

describe('IP country route integration', () => {
  it('uses runtime configuration to query the real MMDB', async () => {
    await expect(
      handler(createTestEvent({ ips: ['81.2.69.142', '2001:218::', '10.0.0.1'] })),
    ).resolves.toEqual({
      results: [
        { ip: '81.2.69.142', countryCode: 'GB' },
        { ip: '2001:218::', countryCode: 'JP' },
        { ip: '10.0.0.1', countryCode: null },
      ],
    })
  })
})
