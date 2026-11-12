import { expect } from '@playwright/test'
import type { Page } from '@playwright/test'

import type { ManagedEventHubStreamEnvelope } from '../../../shared/types/managedEventHub'

interface ManagedEventHubTestStreamState {
  controller?: ReadableStreamDefaultController<Uint8Array>
  requests: unknown[]
}

type ManagedEventHubTestGlobal = typeof globalThis & {
  azureArgusManagedEventHubTestStream?: ManagedEventHubTestStreamState
}

export async function mockManagedEventHubStream(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = globalThis.fetch.bind(globalThis)
    const state: ManagedEventHubTestStreamState = { requests: [] }
    const testGlobal = globalThis as ManagedEventHubTestGlobal
    testGlobal.azureArgusManagedEventHubTestStream = state

    globalThis.fetch = async (input, init) => {
      const requestUrl = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      )
      if (requestUrl.pathname !== '/api/event-hub/stream') {
        return await originalFetch(input, init)
      }

      state.requests.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null)
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          state.controller = undefined
        },
        start(controller) {
          state.controller = controller
        },
      })
      return new Response(body, {
        headers: { 'content-type': 'application/x-ndjson; charset=utf-8' },
        status: 200,
      })
    }
  })
}

export async function enqueueManagedEventHubEnvelope(
  page: Page,
  envelope: ManagedEventHubStreamEnvelope,
) {
  await expect
    .poll(
      async () =>
        await page.evaluate(() =>
          Boolean(
            (globalThis as ManagedEventHubTestGlobal).azureArgusManagedEventHubTestStream
              ?.controller,
          ),
        ),
    )
    .toBe(true)
  await page.evaluate((nextEnvelope) => {
    const controller = (globalThis as ManagedEventHubTestGlobal).azureArgusManagedEventHubTestStream
      ?.controller
    if (!controller) {
      throw new Error('Managed Event Hub test stream is unavailable')
    }
    controller.enqueue(new TextEncoder().encode(`${JSON.stringify(nextEnvelope)}\n`))
  }, envelope)
}

export async function closeManagedEventHubStream(page: Page) {
  await page.evaluate(() => {
    const state = (globalThis as ManagedEventHubTestGlobal).azureArgusManagedEventHubTestStream
    if (!state?.controller) {
      throw new Error('Managed Event Hub test stream is unavailable')
    }
    state.controller.close()
    state.controller = undefined
  })
}

export async function getManagedEventHubRequests(page: Page) {
  return await page.evaluate(
    () =>
      (globalThis as ManagedEventHubTestGlobal).azureArgusManagedEventHubTestStream?.requests ?? [],
  )
}
