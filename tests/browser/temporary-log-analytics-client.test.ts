/// <reference types="vite/client" />

import type { DnsDetailQueryRequest, DnsListQueryRequest } from "../../shared/types/dns";
import type { LogAnalyticsQueryRequest } from "../../shared/types/logAnalytics";
import {
  createTemporaryLogAnalyticsClient,
  TemporaryLogAnalyticsClientError,
} from "../../app/utils/temporaryLogAnalyticsClient.client";

const [logsPageSource] = Object.values(
  import.meta.glob<string>("../../app/pages/logs.vue", {
    eager: true,
    import: "default",
    query: "?raw",
  }),
);

const tenantId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const resourceId =
  "/subscriptions/22222222-2222-4222-8222-222222222222/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub";

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function jsonResponse(value: unknown, init?: ResponseInit) {
  const headers = new Headers(init?.headers);
  headers.set("content-type", "application/json");
  return new Response(JSON.stringify(value), {
    ...init,
    headers,
  });
}

function emptyLogAnalyticsResponse() {
  return jsonResponse({ tables: [] });
}

function createQueryRequest(): LogAnalyticsQueryRequest {
  return {
    from: "2026-07-10T10:00:00.000Z",
    to: "2026-07-10T10:15:00.000Z",
    filters: {
      search: "",
      category: [],
      action: "",
      protocol: "",
      source: "",
      destination: "",
    },
    limit: 100,
    storage: "resource-specific",
    sort: { key: "timestamp", direction: "desc" },
  };
}

function createDnsListRequest(): DnsListQueryRequest {
  return {
    from: "2026-07-10T10:00:00.000Z",
    to: "2026-07-10T10:15:00.000Z",
    filters: {
      search: "",
      queryType: "",
      client: "",
      protocol: "",
      outcome: "",
      source: "",
    },
    limit: 100,
    storage: "resource-specific",
  };
}

function createDnsDetailRequest(): DnsDetailQueryRequest {
  return {
    selector: {
      source: "proxy-structured",
      resourceId,
      timestamp: "2026-07-10T10:01:00.000Z",
      queryId: "22213",
      queryName: "example.com.",
      clientIp: "10.0.0.4",
      clientPort: "52338",
    },
  };
}

function createTokenProvider() {
  return {
    getLogAnalyticsAccessToken: vi
      .fn<(tenantId: string, allowInteractive?: boolean) => Promise<string>>()
      .mockResolvedValue("log-analytics-token"),
    getManagementAccessToken: vi
      .fn<(tenantId: string, allowInteractive?: boolean) => Promise<string>>()
      .mockResolvedValue("management-token"),
  };
}

test("temporary transport sends discovery and every query flow only to matching Azure origins", async () => {
  const tokenProvider = createTokenProvider();
  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = new URL(requestUrl(input));
    if (url.origin === "https://management.azure.com") {
      if (url.pathname === "/tenants") {
        return jsonResponse({ value: [{ displayName: "Tenant", tenantId }] });
      }
      if (url.pathname === "/subscriptions") {
        return jsonResponse({ value: [{ displayName: "Subscription", subscriptionId }] });
      }
      return jsonResponse({ data: [] });
    }
    return emptyLogAnalyticsResponse();
  });
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });
  const signal = new AbortController().signal;

  await client.discover(tenantId, signal);
  await client.query(tenantId, workspaceId, createQueryRequest(), signal);
  await client.dnsReadiness(tenantId, workspaceId, signal);
  await client.dnsList(tenantId, workspaceId, createDnsListRequest(), signal);
  await client.dnsDetail(tenantId, workspaceId, createDnsDetailRequest(), signal);

  expect(tokenProvider.getManagementAccessToken).toHaveBeenCalledTimes(1);
  expect(tokenProvider.getLogAnalyticsAccessToken).toHaveBeenCalledTimes(4);
  const calls = fetchImplementation.mock.calls.map(([input, init]) => {
    const url = new URL(requestUrl(input));
    return {
      authorization: new Headers(init?.headers).get("authorization"),
      origin: url.origin,
      path: url.pathname,
      redirect: init?.redirect,
      url: url.href,
    };
  });
  const managementCalls = calls.filter((call) => call.origin === "https://management.azure.com");
  const logAnalyticsCalls = calls.filter(
    (call) => call.origin === "https://api.loganalytics.azure.com",
  );
  const urls = calls.map((call) => call.url);
  expect(urls.some((url) => url.includes("/api/log-analytics/delegated-"))).toBe(false);
  expect(new Set(calls.map((call) => call.origin))).toEqual(
    new Set(["https://management.azure.com", "https://api.loganalytics.azure.com"]),
  );
  expect(calls.every((call) => call.redirect === "error")).toBe(true);
  expect(managementCalls.map((call) => call.path)).toEqual(
    expect.arrayContaining([
      "/tenants",
      "/subscriptions",
      "/providers/Microsoft.ResourceGraph/resources",
    ]),
  );
  expect(managementCalls.every((call) => call.authorization === "Bearer management-token")).toBe(
    true,
  );
  expect(
    logAnalyticsCalls.every(
      (call) =>
        call.authorization === "Bearer log-analytics-token" &&
        call.path === `/v1/workspaces/${workspaceId}/query`,
    ),
  ).toBe(true);
});

test("temporary logs workspace has no delegated Nitro route wiring", () => {
  expect(logsPageSource).not.toContain("/api/log-analytics/delegated-");
  expect(logsPageSource).toContain("temporaryLogAnalyticsClient.discover(");
  expect(logsPageSource).toContain("temporaryLogAnalyticsClient.query(");
  expect(logsPageSource).toContain("temporaryLogAnalyticsClient.dnsReadiness(");
  expect(logsPageSource).toContain("temporaryLogAnalyticsClient.dnsList(");
  expect(logsPageSource).toContain("temporaryLogAnalyticsClient.dnsDetail(");
});

test("temporary transport rejects invalid tenant and workspace IDs before tokens or requests", async () => {
  const tokenProvider = createTokenProvider();
  const fetchImplementation = vi.fn<typeof fetch>();
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });
  const signal = new AbortController().signal;

  await expect(client.discover("not-a-tenant", signal)).rejects.toMatchObject({
    kind: "validation",
    message: "Azure directory is invalid.",
  });
  await expect(
    client.query(tenantId, "not-a-workspace", createQueryRequest(), signal),
  ).rejects.toMatchObject({
    kind: "validation",
    message: "Log Analytics workspace is invalid.",
  });

  expect(tokenProvider.getManagementAccessToken).not.toHaveBeenCalled();
  expect(tokenProvider.getLogAnalyticsAccessToken).not.toHaveBeenCalled();
  expect(fetchImplementation).not.toHaveBeenCalled();
});

test("temporary discovery enforces one overall timeout including token acquisition", async () => {
  vi.useFakeTimers();
  try {
    const tokenProvider = createTokenProvider();
    tokenProvider.getManagementAccessToken.mockImplementation(() => new Promise(() => {}));
    const fetchImplementation = vi.fn<typeof fetch>();
    const client = createTemporaryLogAnalyticsClient(tokenProvider, {
      discoveryTimeoutMs: 20,
      fetchImplementation,
    });

    const result = client.discover(tenantId, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(21);

    await expect(result).rejects.toEqual(
      new TemporaryLogAnalyticsClientError("Azure resource discovery timed out.", "timeout"),
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

test("temporary discovery sanitizes malformed Azure payloads and aborts sibling requests", async () => {
  const tokenProvider = createTokenProvider();
  let siblingSignal: AbortSignal | undefined;
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(requestUrl(input));
    if (url.pathname === "/tenants") {
      return new Response("customer-specific-sensitive-error", {
        headers: { "content-type": "application/json" },
      });
    }
    siblingSignal = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });

  await expect(client.discover(tenantId, new AbortController().signal)).rejects.toMatchObject({
    kind: "upstream",
    message: "Azure resource discovery failed.",
  });
  expect(siblingSignal?.aborted).toBe(true);
});

test("temporary discovery sanitizes unexpected management-token failures", async () => {
  const tokenProvider = createTokenProvider();
  tokenProvider.getManagementAccessToken.mockRejectedValue(
    new Error("customer-specific-sensitive-error"),
  );
  const fetchImplementation = vi.fn<typeof fetch>();
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });

  await expect(client.discover(tenantId, new AbortController().signal)).rejects.toMatchObject({
    kind: "upstream",
    message: "Azure resource discovery failed.",
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
});

test("temporary query preserves caller cancellation", async () => {
  const tokenProvider = createTokenProvider();
  const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
    return new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });
  });
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });
  const controller = new AbortController();
  const reason = new DOMException("Stopped", "AbortError");

  const result = client.query(tenantId, workspaceId, createQueryRequest(), controller.signal);
  await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalledTimes(1));
  controller.abort(reason);

  await expect(result).rejects.toBe(reason);
});

test.each([
  [
    "DNS readiness",
    (client: ReturnType<typeof createTemporaryLogAnalyticsClient>, signal: AbortSignal) =>
      client.dnsReadiness(tenantId, workspaceId, signal),
  ],
  [
    "DNS listing",
    (client: ReturnType<typeof createTemporaryLogAnalyticsClient>, signal: AbortSignal) =>
      client.dnsList(
        tenantId,
        workspaceId,
        {
          ...createDnsListRequest(),
          filters: { ...createDnsListRequest().filters, source: "proxy-structured" },
        },
        signal,
      ),
  ],
] as const)(
  "temporary %s preserves caller cancellation across source requests",
  async (_name, run) => {
    const tokenProvider = createTokenProvider();
    const fetchImplementation = vi.fn<typeof fetch>((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });
    const controller = new AbortController();
    const reason = new DOMException("Stopped", "AbortError");

    const result = run(client, controller.signal);
    await vi.waitFor(() => expect(fetchImplementation).toHaveBeenCalled());
    controller.abort(reason);

    await expect(result).rejects.toBe(reason);
  },
);

test("temporary query exposes retry timing without leaking Azure response bodies", async () => {
  const tokenProvider = createTokenProvider();
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      jsonResponse(
        { error: { message: "customer-specific-sensitive-error" } },
        { headers: { "retry-after": "17" }, status: 429 },
      ),
    )
    .mockResolvedValueOnce(
      jsonResponse({ error: { message: "customer-specific-sensitive-error" } }, { status: 500 }),
    );
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });
  const signal = new AbortController().signal;

  await expect(
    client.query(tenantId, workspaceId, createQueryRequest(), signal),
  ).rejects.toMatchObject({
    kind: "throttled",
    message: "Log Analytics is throttling requests. Try again in 17 seconds.",
    retryAfterSeconds: 17,
  });
  await expect(
    client.query(tenantId, workspaceId, createQueryRequest(), signal),
  ).rejects.toMatchObject({
    kind: "upstream",
    message: "Log Analytics request failed.",
  });
});

test("temporary query sanitizes unexpected Log Analytics token failures", async () => {
  const tokenProvider = createTokenProvider();
  tokenProvider.getLogAnalyticsAccessToken.mockRejectedValue(
    new Error("customer-specific-sensitive-error"),
  );
  const fetchImplementation = vi.fn<typeof fetch>();
  const client = createTemporaryLogAnalyticsClient(tokenProvider, { fetchImplementation });

  await expect(
    client.query(tenantId, workspaceId, createQueryRequest(), new AbortController().signal),
  ).rejects.toMatchObject({
    kind: "upstream",
    message: "Log Analytics request failed.",
  });
  expect(fetchImplementation).not.toHaveBeenCalled();
});
