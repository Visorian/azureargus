import { mockNuxtImport } from "@nuxt/test-utils/runtime";
import { effectScope } from "vue";

import { useIpCountryLookup } from "../../app/composables/useIpCountryLookup";

const { requestFetch } = vi.hoisted(() => ({
  requestFetch: vi.fn(),
}));

mockNuxtImport("useRequestFetch", () => () => requestFetch);

describe("useIpCountryLookup", () => {
  beforeEach(() => {
    requestFetch.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses same-origin request fetch and aborts it when scope is disposed", async () => {
    let signal: AbortSignal | undefined;
    requestFetch.mockImplementation((_url: string, options: { signal: AbortSignal }) => {
      signal = options.signal;
      return new Promise<unknown>(() => {});
    });
    const scope = effectScope();
    const client = scope.run(() => useIpCountryLookup());

    expect(client).toBeDefined();
    client?.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);

    expect(requestFetch).toHaveBeenCalledWith("/api/ip-country", {
      body: { ips: ["8.8.8.8"] },
      method: "POST",
      signal: expect.any(AbortSignal),
    });
    scope.stop();
    expect(signal?.aborted).toBe(true);
  });
});
