import { expect, type Page } from "@playwright/test";

import type { ManagedEventHubStreamEnvelope } from "../../../shared/types/managedEventHub";

interface ManagedEventHubTestStreamState {
  controller?: ReadableStreamDefaultController<Uint8Array>;
  requests: unknown[];
}

type ManagedEventHubTestWindow = Window & {
  __azureArgusManagedEventHubStream?: ManagedEventHubTestStreamState;
};

export async function mockManagedEventHubStream(page: Page) {
  await page.addInitScript(() => {
    const originalFetch = window.fetch.bind(window);
    const state: ManagedEventHubTestStreamState = { requests: [] };
    const testWindow = window as ManagedEventHubTestWindow;
    testWindow.__azureArgusManagedEventHubStream = state;

    window.fetch = async (input, init) => {
      const requestUrl = new URL(
        input instanceof Request ? input.url : String(input),
        location.href,
      );
      if (requestUrl.pathname !== "/api/event-hub/stream") {
        return originalFetch(input, init);
      }

      state.requests.push(typeof init?.body === "string" ? JSON.parse(init.body) : null);
      const body = new ReadableStream<Uint8Array>({
        cancel() {
          state.controller = undefined;
        },
        start(controller) {
          state.controller = controller;
        },
      });
      return new Response(body, {
        headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        status: 200,
      });
    };
  });
}

export async function enqueueManagedEventHubEnvelope(
  page: Page,
  envelope: ManagedEventHubStreamEnvelope,
) {
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          (window as ManagedEventHubTestWindow).__azureArgusManagedEventHubStream?.controller,
        ),
      ),
    )
    .toBe(true);
  await page.evaluate((nextEnvelope) => {
    const controller = (window as ManagedEventHubTestWindow).__azureArgusManagedEventHubStream
      ?.controller;
    if (!controller) {
      throw new Error("Managed Event Hub test stream is unavailable");
    }
    controller.enqueue(new TextEncoder().encode(`${JSON.stringify(nextEnvelope)}\n`));
  }, envelope);
}

export function getManagedEventHubRequests(page: Page) {
  return page.evaluate(
    () => (window as ManagedEventHubTestWindow).__azureArgusManagedEventHubStream?.requests ?? [],
  );
}
