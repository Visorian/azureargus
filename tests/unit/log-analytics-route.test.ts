import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";
import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";

import { LOG_ANALYSIS_ROLE, type LogAnalyticsQueryRequest } from "../../shared/types/logAnalytics";
import { getLogAnalyticsAccessToken } from "../../server/utils/logAnalyticsAuth";
import {
  executeLogAnalyticsQuery,
  LogAnalyticsQueryError,
} from "../../server/utils/logAnalyticsQuery";

vi.mock("nuxt-oidc-auth/runtime/server/utils/session.js", () => ({
  requireUserSession: vi.fn(),
}));
vi.mock("../../server/utils/logAnalyticsAuth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/logAnalyticsAuth")>()),
  getLogAnalyticsAccessToken: vi.fn(),
}));
vi.mock("../../server/utils/logAnalyticsQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/logAnalyticsQuery")>()),
  executeLogAnalyticsQuery: vi.fn(),
}));

const config = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "secret",
  workspaceId: "33333333-3333-3333-3333-333333333333",
};
let runtimeConfig: { logAnalytics: typeof config };
let handler: (event: H3Event) => Promise<unknown>;

function createRequest(): LogAnalyticsQueryRequest {
  return {
    filters: {
      action: "",
      category: "",
      destination: "",
      protocol: "",
      search: "",
      source: "",
    },
    from: "2026-07-10T10:00:00.000Z",
    sort: { direction: "desc", key: "timestamp" },
    to: "2026-07-10T10:15:00.000Z",
  };
}

function createTestEvent(body?: unknown) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
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
  runtimeConfig = { logAnalytics: config };
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  handler = (await import("../../server/api/log-analytics/query.post")).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  runtimeConfig = { logAnalytics: config };
  vi.mocked(requireUserSession).mockReset();
  vi.mocked(getLogAnalyticsAccessToken).mockReset().mockResolvedValue("access-token");
  vi.mocked(executeLogAnalyticsQuery).mockReset().mockResolvedValue({
    limit: 1_000,
    records: [],
    truncated: false,
  });
});

describe("Log Analytics query route authorization", () => {
  it.each([
    ["wrong tenant", { tid: "another-tenant", roles: [LOG_ANALYSIS_ROLE] }],
    ["missing role", { tid: config.tenantId, roles: ["Other.Role"] }],
  ])("returns 403 for %s before reading query body", async (_label, claims) => {
    vi.mocked(requireUserSession).mockResolvedValue({ provider: "entra", claims });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns 403 before exposing unrelated configuration failure", async () => {
    runtimeConfig = { logAnalytics: { ...config, clientSecret: "" } };
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: ["Other.Role"] },
    });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns 503 for authorized session when private configuration is incomplete", async () => {
    runtimeConfig = { logAnalytics: { ...config, clientSecret: "" } };
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: [LOG_ANALYSIS_ROLE] },
    });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 503 });
  });

  it("returns query results for an authorized valid request", async () => {
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: [LOG_ANALYSIS_ROLE] },
    });
    const request = createRequest();

    await expect(handler(createTestEvent(request))).resolves.toEqual({
      limit: 1_000,
      records: [],
      truncated: false,
    });
    expect(getLogAnalyticsAccessToken).toHaveBeenCalledOnce();
    expect(executeLogAnalyticsQuery).toHaveBeenCalledWith(
      config,
      request,
      "access-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("rejects an invalid request before contacting Azure", async () => {
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: [LOG_ANALYSIS_ROLE] },
    });

    await expect(
      handler(createTestEvent({ ...createRequest(), workspaceId: "caller-controlled" })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(getLogAnalyticsAccessToken).not.toHaveBeenCalled();
    expect(executeLogAnalyticsQuery).not.toHaveBeenCalled();
  });

  it.each([
    [new LogAnalyticsQueryError("throttled", 30), 429],
    [new LogAnalyticsQueryError("timeout"), 504],
    [new LogAnalyticsQueryError("upstream"), 502],
  ])("maps Azure query failures to the expected HTTP status", async (error, statusCode) => {
    vi.mocked(requireUserSession).mockResolvedValue({
      provider: "entra",
      claims: { tid: config.tenantId, roles: [LOG_ANALYSIS_ROLE] },
    });
    vi.mocked(executeLogAnalyticsQuery).mockRejectedValueOnce(error);
    const event = createTestEvent(createRequest());

    await expect(handler(event)).rejects.toMatchObject({ statusCode });
    if (statusCode === 429) {
      expect(event.node.res.getHeader("retry-after")).toBe(30);
    }
  });
});
