import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { EventHubConsumerClient } from "@azure/event-hubs";
import { createEvent, type H3Event } from "h3";
import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";

import {
  createManagedEventHubStream,
  pipeManagedEventHubStream,
} from "../../server/utils/managedEventHubStream";

vi.mock("@azure/event-hubs", () => ({
  EventHubConsumerClient: vi.fn(),
}));
vi.mock("nuxt-oidc-auth/runtime/server/utils/session.js", () => ({
  requireUserSession: vi.fn(),
}));
vi.mock("../../server/utils/managedEventHubStream", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/utils/managedEventHubStream")>()),
  createManagedEventHubStream: vi.fn(),
  pipeManagedEventHubStream: vi.fn(),
}));

const runtimeConfig = {
  eventHub: {
    connectionString:
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=private-secret;EntityPath=firewall-logs",
    name: "",
  },
  oidc: {
    providers: {
      entra: {
        authorizationUrl: "https://login.example.com/authorize",
        clientId: "44444444-4444-4444-8444-444444444444",
        clientSecret: "login-secret",
        redirectUri: "https://app.example.com/auth/callback",
        tokenUrl: "https://login.example.com/token",
      },
    },
  },
};
let currentRuntimeConfig: Record<string, unknown> = runtimeConfig;
let handler: (event: H3Event) => Promise<unknown>;
const useRuntimeConfig = vi.fn(() => currentRuntimeConfig);

function createTestEvent(body?: unknown, headers: Record<string, string> = {}) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  request.method = "POST";
  request.headers.host = "app.example.com";
  Object.assign(request.headers, {
    origin: "http://app.example.com",
    "sec-fetch-site": "same-origin",
    ...headers,
  });
  if (body !== undefined) {
    const payload = JSON.stringify(body);
    request.headers["content-length"] = String(Buffer.byteLength(payload));
    request.headers["content-type"] = "application/json";
    request.push(payload);
    request.push(null);
  }
  return createEvent(request, response);
}

beforeAll(async () => {
  vi.stubEnv("NUXT_OIDC_AUTH_SESSION_SECRET", "s".repeat(48));
  vi.stubEnv("NUXT_OIDC_SESSION_SECRET", "s".repeat(48));
  vi.stubEnv("NUXT_OIDC_TOKEN_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", useRuntimeConfig);
  handler = (await import("../../server/api/event-hub/stream.post")).default;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  currentRuntimeConfig = runtimeConfig;
  useRuntimeConfig.mockClear();
  vi.mocked(requireUserSession).mockReset().mockResolvedValue({ expireAt: 1_800_000_000 });
  vi.mocked(EventHubConsumerClient).mockReset();
  vi.mocked(createManagedEventHubStream).mockReset();
  vi.mocked(pipeManagedEventHubStream).mockReset().mockResolvedValue(undefined);
});

describe("managed Event Hub stream route", () => {
  it("requires a session before reading deployment configuration", async () => {
    vi.mocked(requireUserSession).mockRejectedValueOnce({ statusCode: 401 });

    await expect(handler(createTestEvent())).rejects.toMatchObject({ statusCode: 401 });
    expect(useRuntimeConfig).not.toHaveBeenCalled();
    expect(EventHubConsumerClient).not.toHaveBeenCalled();
    expect(createManagedEventHubStream).not.toHaveBeenCalled();
  });

  it("rejects deployments without managed Event Hub capability", async () => {
    currentRuntimeConfig = {};

    await expect(
      handler(createTestEvent({ consumerGroup: "$Default", lookbackMinutes: 5 })),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(EventHubConsumerClient).not.toHaveBeenCalled();
    expect(createManagedEventHubStream).not.toHaveBeenCalled();
  });

  it.each([
    [
      "cross-origin requests",
      { consumerGroup: "$Default", lookbackMinutes: 5 },
      { origin: "https://attacker.example", "sec-fetch-site": "cross-site" },
      403,
    ],
    ["invalid request DTOs", { consumerGroup: "$Default", lookbackMinutes: 30 }, {}, 400],
    [
      "request DTOs containing credentials",
      { consumerGroup: "$Default", lookbackMinutes: 5, connectionString: "caller-secret" },
      {},
      400,
    ],
  ])("rejects %s before constructing an Azure client", async (_name, body, headers, statusCode) => {
    await expect(handler(createTestEvent(body, headers))).rejects.toMatchObject({ statusCode });
    expect(EventHubConsumerClient).not.toHaveBeenCalled();
    expect(createManagedEventHubStream).not.toHaveBeenCalled();
  });

  it("rejects requests without an Origin header before constructing an Azure client", async () => {
    const event = createTestEvent({ consumerGroup: "$Default", lookbackMinutes: 5 });
    delete event.node.req.headers.origin;

    await expect(handler(event)).rejects.toMatchObject({ statusCode: 403 });
    expect(EventHubConsumerClient).not.toHaveBeenCalled();
  });

  it("sanitizes Azure client construction failures", async () => {
    vi.mocked(EventHubConsumerClient).mockImplementationOnce(() => {
      throw new Error(`Could not use ${runtimeConfig.eventHub.connectionString}`);
    });

    await expect(
      handler(createTestEvent({ consumerGroup: "$Default", lookbackMinutes: 5 })),
    ).rejects.toMatchObject({
      message: "Managed Event Hub could not start",
      statusCode: 502,
    });
  });

  it.each([
    [runtimeConfig.eventHub.connectionString, "", 2],
    [
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=private-secret",
      "firewall-logs",
      3,
    ],
  ])(
    "streams managed events with server-owned credentials",
    async (connectionString, eventHubName, constructorArgumentCount) => {
      currentRuntimeConfig = {
        ...runtimeConfig,
        eventHub: { connectionString, name: eventHubName },
      };
      const stream = new ReadableStream<Uint8Array>();
      const cleanup = vi.fn(async () => undefined);
      vi.mocked(createManagedEventHubStream).mockReturnValue({ cleanup, stream });
      const event = createTestEvent({ consumerGroup: "$Default", lookbackMinutes: 5 });

      await handler(event);

      expect(EventHubConsumerClient).toHaveBeenCalledOnce();
      expect(EventHubConsumerClient.mock.calls[0]).toHaveLength(constructorArgumentCount);
      expect(createManagedEventHubStream).toHaveBeenCalledWith(
        expect.objectContaining({
          request: { consumerGroup: "$Default", lookbackMinutes: 5 },
        }),
      );
      expect(pipeManagedEventHubStream).toHaveBeenCalledWith(event.node.res, stream);
      expect(event.node.res.getHeader("content-type")).toBe("application/x-ndjson; charset=utf-8");
      expect(event.node.res.getHeader("x-accel-buffering")).toBe("no");
      expect(cleanup).toHaveBeenCalledOnce();
    },
  );
});
