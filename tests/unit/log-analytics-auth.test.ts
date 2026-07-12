import {
  createLogAnalyticsTokenProvider,
  LogAnalyticsConfigurationError,
  LogAnalyticsTokenError,
  parseLogAnalyticsRuntimeConfig,
  type LogAnalyticsRuntimeConfig,
} from "../../server/utils/logAnalyticsAuth";

const config: LogAnalyticsRuntimeConfig = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "secret",
  workspaceId: "33333333-3333-3333-3333-333333333333",
};
describe("Log Analytics configuration", () => {
  it("rejects incomplete private runtime config", () => {
    expect(parseLogAnalyticsRuntimeConfig(config)).toEqual(config);
    expect(() => parseLogAnalyticsRuntimeConfig({ ...config, clientSecret: "" })).toThrow(
      LogAnalyticsConfigurationError,
    );
  });
});

describe("Log Analytics token provider", () => {
  it("caches tokens until expiry skew is reached", async () => {
    let now = 1_000;
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-1", expires_in: 120 }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "token-2", expires_in: 120 }), { status: 200 }),
      );
    const getToken = createLogAnalyticsTokenProvider(fetchImplementation, () => now);

    await expect(getToken(config)).resolves.toBe("token-1");
    await expect(getToken(config)).resolves.toBe("token-1");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    now += 60_001;
    await expect(getToken(config)).resolves.toBe("token-2");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);

    const [url, init] = fetchImplementation.mock.calls[0] ?? [];
    expect(url).toBe(`https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`);
    expect(String(init?.body)).toContain("scope=https%3A%2F%2Fapi.loganalytics.io%2F.default");
  });

  it("deduplicates concurrent token requests", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const getToken = createLogAnalyticsTokenProvider(fetchImplementation);

    const first = getToken(config);
    const second = getToken(config);
    resolveResponse?.(
      new Response(JSON.stringify({ access_token: "shared-token", expires_in: 3_600 }), {
        status: 200,
      }),
    );

    await expect(Promise.all([first, second])).resolves.toEqual(["shared-token", "shared-token"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("normalizes token endpoint failures without response bodies", async () => {
    const fetchImplementation = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("sensitive upstream body", { status: 429 }));
    const getToken = createLogAnalyticsTokenProvider(fetchImplementation);

    const error = await getToken(config).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LogAnalyticsTokenError);
    expect(error).toMatchObject({
      kind: "throttled",
      message: "Log Analytics token acquisition failed",
    });
  });

  it("bounds token acquisition with a timeout", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation((_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
    });
    const getToken = createLogAnalyticsTokenProvider(fetchImplementation, Date.now, 1);

    const error = await getToken(config).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(LogAnalyticsTokenError);
    expect(error).toMatchObject({ kind: "upstream" });
  });

  it("allows a caller to stop waiting without cancelling shared acquisition", async () => {
    let resolveResponse: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const getToken = createLogAnalyticsTokenProvider(fetchImplementation);
    const controller = new AbortController();
    const request = getToken(config, controller.signal);

    controller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });

    resolveResponse?.(
      new Response(JSON.stringify({ access_token: "cached-token", expires_in: 3_600 }), {
        status: 200,
      }),
    );
    await expect(getToken(config)).resolves.toBe("cached-token");
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });

  it("does not share an in-flight token across client configurations", async () => {
    const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
      const clientId = new URLSearchParams(String(init?.body)).get("client_id");
      return new Response(
        JSON.stringify({ access_token: `token-${clientId}`, expires_in: 3_600 }),
        { status: 200 },
      );
    });
    const getToken = createLogAnalyticsTokenProvider(fetchImplementation);
    const secondConfig = { ...config, clientId: "another-client" };

    await expect(Promise.all([getToken(config), getToken(secondConfig)])).resolves.toEqual([
      `token-${config.clientId}`,
      "token-another-client",
    ]);
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});
