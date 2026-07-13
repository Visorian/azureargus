import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";
import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";

import type { DelegatedDnsDetailQueryRequest, DnsListQueryRequest } from "../../shared/types/dns";
import {
  executeDnsDetailQuery,
  executeDnsListQuery,
} from "../../server/utils/dnsLogAnalyticsQuery";
import { getLogAnalyticsAccessToken } from "../../server/utils/logAnalyticsAuth";

vi.mock("nuxt-oidc-auth/runtime/server/utils/session.js", () => ({
  requireUserSession: vi.fn<typeof requireUserSession>(),
}));
vi.mock("../../server/utils/logAnalyticsAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/logAnalyticsAuth")>()),
  getLogAnalyticsAccessToken: vi.fn<typeof getLogAnalyticsAccessToken>(),
}));
vi.mock("../../server/utils/dnsLogAnalyticsQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/dnsLogAnalyticsQuery")>()),
  executeDnsDetailQuery: vi.fn<typeof executeDnsDetailQuery>(),
  executeDnsListQuery: vi.fn<typeof executeDnsListQuery>(),
}));

const managedConfig = {
  tenantId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  clientSecret: "secret",
  workspaceId: "33333333-3333-4333-8333-333333333333",
};
const oidc = {
  providers: {
    entra: {
      authorizationUrl: "https://login.example.com/authorize",
      clientId: "44444444-4444-4444-8444-444444444444",
      clientSecret: "login-secret",
      redirectUri: "https://app.example.com/auth/callback",
      tokenUrl: "https://login.example.com/token",
    },
  },
};
const delegatedConfig = {
  public: {
    logAnalyticsDelegated: {
      clientId: "55555555-5555-4555-8555-555555555555",
      tenantId: "66666666-6666-4666-8666-666666666666",
    },
  },
};
const resourceId =
  "/subscriptions/77777777-7777-4777-8777-777777777777/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub";

let runtimeConfig: Record<string, unknown>;
let managedListHandler: (event: H3Event) => Promise<unknown>;
let delegatedDetailHandler: (event: H3Event) => Promise<unknown>;

function createListRequest(): DnsListQueryRequest {
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
  };
}

function createDelegatedDetailRequest(): DelegatedDnsDetailQueryRequest {
  return {
    workspaceId: "88888888-8888-4888-8888-888888888888",
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

function createTestEvent(body?: unknown, authorization?: string) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  if (authorization !== undefined) request.headers.authorization = authorization;
  if (body !== undefined) {
    const payload = JSON.stringify(body);
    request.method = "POST";
    request.headers["content-length"] = String(Buffer.byteLength(payload));
    request.headers["content-type"] = "application/json";
    request.push(payload);
    request.push(null);
  }
  return createEvent(request, response);
}

beforeAll(async () => {
  vi.stubEnv("NUXT_OIDC_AUTH_SESSION_SECRET", "s".repeat(32));
  vi.stubEnv("NUXT_OIDC_SESSION_SECRET", "s".repeat(48));
  vi.stubEnv("NUXT_OIDC_TOKEN_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubGlobal("defineEventHandler", <T>(handler: T) => handler);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  managedListHandler = (await import("../../server/api/log-analytics/dns/list.post")).default;
  delegatedDetailHandler = (
    await import("../../server/api/log-analytics/delegated-dns/detail.post")
  ).default;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  runtimeConfig = { logAnalytics: managedConfig, oidc };
  vi.mocked(requireUserSession)
    .mockReset()
    .mockResolvedValue({
      provider: "entra",
      claims: { sub: "user" },
    });
  vi.mocked(getLogAnalyticsAccessToken).mockReset().mockResolvedValue("managed-token");
  vi.mocked(executeDnsListQuery).mockReset().mockResolvedValue({
    queriedEntries: [],
    transportObservations: [],
    queriedEntriesTruncated: false,
    transportObservationsTruncated: false,
    sources: [],
  });
  vi.mocked(executeDnsDetailQuery).mockReset().mockResolvedValue({
    observations: [],
    detailTruncated: false,
    completeness: "partial",
    warnings: [],
  });
});

describe("managed DNS list route", () => {
  it("requires login before reading managed configuration", async () => {
    runtimeConfig = { logAnalytics: { ...managedConfig, clientSecret: "" }, oidc };
    vi.mocked(requireUserSession).mockRejectedValueOnce({ statusCode: 401 });

    await expect(managedListHandler(createTestEvent())).rejects.toMatchObject({
      statusCode: 401,
    });
    expect(getLogAnalyticsAccessToken).not.toHaveBeenCalled();
    expect(executeDnsListQuery).not.toHaveBeenCalled();
  });

  it("uses fixed workspace credentials and propagates request cancellation", async () => {
    let querySignal: AbortSignal | undefined;
    vi.mocked(executeDnsListQuery).mockImplementationOnce(
      async (_target, _request, _token, options) => {
        if (!options?.signal) throw new Error("Expected incoming request signal");
        const signal = options.signal;
        querySignal = signal;
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }),
        );
        return {
          queriedEntries: [],
          transportObservations: [],
          queriedEntriesTruncated: false,
          transportObservationsTruncated: false,
          sources: [],
        };
      },
    );
    const request = createListRequest();
    const event = createTestEvent(request);
    const response = managedListHandler(event);
    await vi.waitFor(() => expect(executeDnsListQuery).toHaveBeenCalledOnce());

    event.node.req.emit("aborted");
    await expect(response).resolves.toMatchObject({ queriedEntries: [] });

    expect(querySignal?.aborted).toBe(true);
    expect(getLogAnalyticsAccessToken).toHaveBeenCalledWith(managedConfig, expect.any(AbortSignal));
    expect(executeDnsListQuery).toHaveBeenCalledWith(
      managedConfig,
      request,
      "managed-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects unavailable capability and caller-controlled workspace", async () => {
    runtimeConfig = {};
    await expect(managedListHandler(createTestEvent(createListRequest()))).rejects.toMatchObject({
      statusCode: 403,
    });

    runtimeConfig = { logAnalytics: managedConfig, oidc };
    await expect(
      managedListHandler(
        createTestEvent({ ...createListRequest(), workspaceId: "caller-controlled" }),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(executeDnsListQuery).not.toHaveBeenCalled();
  });
});

describe("delegated DNS detail route", () => {
  it("uses bearer token and validated caller workspace without forwarding workspace in body", async () => {
    runtimeConfig = delegatedConfig;
    const request = createDelegatedDetailRequest();

    await expect(
      delegatedDetailHandler(createTestEvent(request, "Bearer delegated-token")),
    ).resolves.toMatchObject({ observations: [] });

    const { workspaceId, ...detailRequest } = request;
    expect(executeDnsDetailQuery).toHaveBeenCalledWith(
      { workspaceId },
      detailRequest,
      "delegated-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getLogAnalyticsAccessToken).not.toHaveBeenCalled();
  });

  it("rejects missing bearer token and invalid delegated contracts", async () => {
    runtimeConfig = delegatedConfig;

    await expect(
      delegatedDetailHandler(createTestEvent(createDelegatedDetailRequest())),
    ).rejects.toMatchObject({ statusCode: 401 });
    await expect(
      delegatedDetailHandler(
        createTestEvent(
          { ...createDelegatedDetailRequest(), workspaceId: "not-a-workspace" },
          "Bearer delegated-token",
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(executeDnsDetailQuery).not.toHaveBeenCalled();
  });

  it("rejects delegated detail outside anonymous delegated capability", async () => {
    runtimeConfig = { logAnalytics: managedConfig, oidc };

    await expect(
      delegatedDetailHandler(
        createTestEvent(createDelegatedDetailRequest(), "Bearer delegated-token"),
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(executeDnsDetailQuery).not.toHaveBeenCalled();
  });
});
