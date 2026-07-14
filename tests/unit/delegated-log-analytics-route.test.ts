import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";

import type { DelegatedLogAnalyticsQueryRequest } from "../../shared/types/logAnalytics";
import {
  executeLogAnalyticsQuery,
  LogAnalyticsQueryError,
} from "../../server/utils/logAnalyticsQuery";

vi.mock("../../server/utils/logAnalyticsQuery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/logAnalyticsQuery")>()),
  executeLogAnalyticsQuery: vi.fn(),
}));

const delegatedConfig = {
  public: {
    logAnalyticsDelegated: {
      clientId: "11111111-1111-4111-8111-111111111111",
    },
  },
};
let runtimeConfig: Record<string, unknown>;
let handler: (event: H3Event) => Promise<unknown>;

function createRequest(): DelegatedLogAnalyticsQueryRequest {
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
    limit: 1_000,
    sort: { direction: "desc", key: "timestamp" },
    to: "2026-07-10T10:15:00.000Z",
    workspaceId: "33333333-3333-4333-8333-333333333333",
  };
}

function createTestEvent(body: unknown, authorization = "Bearer delegated-token") {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const payload = JSON.stringify(body);
  request.method = "POST";
  request.headers.authorization = authorization;
  request.headers["content-length"] = String(Buffer.byteLength(payload));
  request.headers["content-type"] = "application/json";
  request.push(payload);
  request.push(null);
  return createEvent(request, response);
}

beforeAll(async () => {
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  handler = (await import("../../server/api/log-analytics/delegated-query.post")).default;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  runtimeConfig = delegatedConfig;
  vi.mocked(executeLogAnalyticsQuery).mockReset().mockResolvedValue({
    limit: 1_000,
    records: [],
    truncated: false,
  });
});

describe("delegated Log Analytics query route", () => {
  it("accepts an anonymous delegated request and keeps token out of body", async () => {
    const request = createRequest();

    await expect(handler(createTestEvent(request))).resolves.toMatchObject({ records: [] });

    const { workspaceId, ...query } = request;
    expect(executeLogAnalyticsQuery).toHaveBeenCalledWith(
      { workspaceId },
      query,
      "delegated-token",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(JSON.stringify(request)).not.toContain("delegated-token");
  });

  it("rejects missing or malformed bearer authorization before querying Azure", async () => {
    await expect(handler(createTestEvent(createRequest(), ""))).rejects.toMatchObject({
      statusCode: 401,
    });
    await expect(
      handler(createTestEvent(createRequest(), "Basic delegated-token")),
    ).rejects.toMatchObject({ statusCode: 401 });
    expect(executeLogAnalyticsQuery).not.toHaveBeenCalled();
  });

  it("rejects delegated access outside configured anonymous mode", async () => {
    runtimeConfig = {};
    await expect(handler(createTestEvent(createRequest()))).rejects.toMatchObject({
      statusCode: 403,
    });

    runtimeConfig = {
      ...delegatedConfig,
      eventHub: {
        connectionString:
          "Endpoint=sb://argus.servicebus.windows.net/;SharedAccessKeyName=reader;SharedAccessKey=secret;EntityPath=logs",
      },
    };
    await expect(handler(createTestEvent(createRequest()))).rejects.toMatchObject({
      statusCode: 503,
    });
    expect(executeLogAnalyticsQuery).not.toHaveBeenCalled();
  });

  it("rejects invalid workspace and caller-controlled body fields", async () => {
    await expect(
      handler(createTestEvent({ ...createRequest(), workspaceId: "not-a-workspace" })),
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(
      handler(createTestEvent({ ...createRequest(), token: "body-token" })),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(executeLogAnalyticsQuery).not.toHaveBeenCalled();
  });

  it.each([
    [new LogAnalyticsQueryError("authorization"), 403],
    [new LogAnalyticsQueryError("throttled", 15), 429],
    [new LogAnalyticsQueryError("timeout"), 504],
    [new LogAnalyticsQueryError("upstream"), 502],
  ])(
    "maps delegated Azure failures without returning upstream bodies",
    async (error, statusCode) => {
      vi.mocked(executeLogAnalyticsQuery).mockRejectedValueOnce(error);
      const event = createTestEvent(createRequest());

      await expect(handler(event)).rejects.toMatchObject({ statusCode });
      expect(event.node.res.getHeader("retry-after")).toBe(statusCode === 429 ? 15 : undefined);
    },
  );
});
