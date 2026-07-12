import {
  createIpCountryLookupClient,
  type IpCountryLookupClient,
} from "../../app/composables/useIpCountryLookup";
import type { IpCountryLookupResponse } from "../../shared/types/ipCountry";

function createResponse(ips: string[], countryCode: string | null = "DE"): IpCountryLookupResponse {
  return { results: ips.map((ip) => ({ ip, countryCode })) };
}

describe("IP country client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches and deduplicates queued destinations", async () => {
    const request = vi.fn(async ({ ips }) => createResponse(ips));
    const client = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    client.queue("8.8.8.8");
    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(50);

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0]).toEqual({ ips: ["8.8.8.8", "1.1.1.1"] });
    expect(client.getCountryCode("8.8.8.8")).toBe("DE");
    client.dispose();
  });

  it("caps batches and keeps one request in flight", async () => {
    let resolveFirst: ((response: IpCountryLookupResponse) => void) | undefined;
    const request = vi
      .fn<(body: { ips: string[] }, signal: AbortSignal) => Promise<IpCountryLookupResponse>>()
      .mockImplementationOnce(
        ({ ips }) =>
          new Promise((resolve) => {
            resolveFirst = () => resolve(createResponse(ips));
          }),
      )
      .mockImplementation(async ({ ips }) => createResponse(ips));
    const client = createIpCountryLookupClient(request);

    for (let index = 0; index < 40; index++) {
      client.queue(`8.8.8.${index}`);
    }
    await vi.advanceTimersByTimeAsync(50);
    client.queue("8.8.8.0");
    await vi.advanceTimersByTimeAsync(50);

    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0]?.[0].ips).toHaveLength(32);

    resolveFirst?.(createResponse(request.mock.calls[0]?.[0].ips ?? []));
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0].ips).toHaveLength(8);
    client.dispose();
  });

  it("keeps late results keyed to their original destination", async () => {
    let resolveFirst: ((response: IpCountryLookupResponse) => void) | undefined;
    const request = vi
      .fn<(body: { ips: string[] }, signal: AbortSignal) => Promise<IpCountryLookupResponse>>()
      .mockImplementationOnce(
        ({ ips }) =>
          new Promise((resolve) => {
            resolveFirst = () => resolve(createResponse(ips, "DE"));
          }),
      )
      .mockImplementation(async ({ ips }) => createResponse(ips, "US"));
    const client = createIpCountryLookupClient(request);

    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("8.8.8.8");
    resolveFirst?.(createResponse(["1.1.1.1"], "DE"));
    await vi.advanceTimersByTimeAsync(50);

    expect(client.getCountryCode("1.1.1.1")).toBe("DE");
    expect(client.getCountryCode("8.8.8.8")).toBe("US");
    client.dispose();
  });

  it("bounds positive and negative cache entries", async () => {
    const request = vi.fn(async ({ ips }) => createResponse(ips, null));
    const client = createIpCountryLookupClient(request, { cacheSize: 2 });

    for (const ip of ["1.1.1.1", "8.8.8.8", "9.9.9.9"]) {
      client.queue(ip);
      await vi.advanceTimersByTimeAsync(50);
    }

    expect(client.getCountryCode("1.1.1.1")).toBeUndefined();
    expect(client.getCountryCode("8.8.8.8")).toBeNull();
    expect(client.getCountryCode("9.9.9.9")).toBeNull();
    client.dispose();
  });

  it("refreshes LRU recency when a cached destination is queued again", async () => {
    const request = vi.fn(async ({ ips }) => createResponse(ips));
    const client = createIpCountryLookupClient(request, { cacheSize: 2 });

    client.queue("1.1.1.1");
    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("1.1.1.1");
    client.queue("9.9.9.9");
    await vi.advanceTimersByTimeAsync(50);

    expect(client.getCountryCode("1.1.1.1")).toBe("DE");
    expect(client.getCountryCode("8.8.8.8")).toBeUndefined();
    expect(client.getCountryCode("9.9.9.9")).toBe("DE");
    client.dispose();
  });

  it("does not refetch a negatively cached destination", async () => {
    const request = vi.fn(async ({ ips }) => createResponse(ips, null));
    const client = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);

    expect(request).toHaveBeenCalledOnce();
    expect(client.getCountryCode("8.8.8.8")).toBeNull();
    client.dispose();
  });

  it("fails closed without retrying malformed successful responses", async () => {
    const request = vi.fn(async () => ({}));
    const client = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(request).toHaveBeenCalledOnce();
    expect(client.getCountryCode("8.8.8.8")).toBeUndefined();
    client.dispose();
  });

  it("ignores unknown results and negatively caches missing or invalid countries", async () => {
    const request = vi.fn(async () => ({
      results: [
        { ip: "203.0.113.1", countryCode: "US" },
        { ip: "8.8.8.8", countryCode: "invalid" },
      ],
    }));
    const client = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(50);

    expect(client.getCountryCode("8.8.8.8")).toBeNull();
    expect(client.getCountryCode("1.1.1.1")).toBeNull();
    expect(client.getCountryCode("203.0.113.1")).toBeUndefined();
    client.dispose();
  });

  it("disables session after unavailable response", async () => {
    const request = vi.fn(async () => {
      throw { statusCode: 503 };
    });
    const client = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(request).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("disables session after a permanent client error", async () => {
    const request = vi.fn(async () => {
      throw { statusCode: 400 };
    });
    const client = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(60_000);

    expect(request).toHaveBeenCalledOnce();
    client.dispose();
  });

  it("shares transient cooldown and retries failed batch once", async () => {
    const request = vi
      .fn<(body: { ips: string[] }, signal: AbortSignal) => Promise<IpCountryLookupResponse>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(async ({ ips }) => createResponse(ips, "US"));
    const client = createIpCountryLookupClient(request, { failureCooldownMs: 100 });

    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(99);
    expect(request).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(50);

    expect(request).toHaveBeenCalledTimes(2);
    expect(client.getCountryCode("8.8.8.8")).toBe("US");
    client.dispose();
  });

  it("bounds pending work and keeps latest destinations during cooldown", async () => {
    const request = vi
      .fn<(body: { ips: string[] }, signal: AbortSignal) => Promise<IpCountryLookupResponse>>()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementation(async ({ ips }) => createResponse(ips, "US"));
    const client = createIpCountryLookupClient(request, {
      failureCooldownMs: 100,
      pendingSize: 2,
    });

    client.queue("1.1.1.1");
    await vi.advanceTimersByTimeAsync(50);
    client.queue("2.2.2.2");
    client.queue("3.3.3.3");
    client.queue("4.4.4.4");
    await vi.advanceTimersByTimeAsync(150);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]?.[0]).toEqual({ ips: ["3.3.3.3", "4.4.4.4"] });
    client.dispose();
  });

  it("aborts active request when disposed", async () => {
    let signal: AbortSignal | undefined;
    const request = vi.fn((_body, nextSignal: AbortSignal) => {
      signal = nextSignal;
      return new Promise<IpCountryLookupResponse>(() => {});
    });
    let client: IpCountryLookupClient | undefined = createIpCountryLookupClient(request);

    client.queue("8.8.8.8");
    await vi.advanceTimersByTimeAsync(50);
    client.dispose();

    expect(signal?.aborted).toBe(true);
    client = undefined;
  });
});
