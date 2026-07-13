import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import { createEvent, type H3Event } from "h3";

const runtimeConfig = {
  eventHub: {
    connectionString:
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=private-event-hub-secret;EntityPath=firewall-logs",
    name: "",
  },
  oidc: {
    providers: {
      entra: {
        authorizationUrl: "https://login.example.com/authorize",
        clientId: "44444444-4444-4444-8444-444444444444",
        clientSecret: "private-login-secret",
        redirectUri: "https://app.example.com/auth/entra/callback",
        tokenUrl: "https://login.example.com/token",
      },
    },
  },
};

let handler: (event: H3Event) => unknown;

beforeAll(async () => {
  vi.stubEnv("NUXT_OIDC_AUTH_SESSION_SECRET", "a".repeat(32));
  vi.stubEnv("NUXT_OIDC_SESSION_SECRET", "s".repeat(48));
  vi.stubEnv("NUXT_OIDC_TOKEN_KEY", Buffer.alloc(32).toString("base64"));
  vi.stubGlobal("defineEventHandler", <T>(eventHandler: T) => eventHandler);
  vi.stubGlobal("useRuntimeConfig", () => runtimeConfig);
  handler = (await import("../../server/api/capabilities.get")).default;
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deployment capabilities route", () => {
  it("returns only safe capability metadata without caching", () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);
    const event = createEvent(request, response);

    const result = handler(event);
    const serialized = JSON.stringify(result);

    expect(result).toEqual({
      errors: [],
      eventHubAvailable: true,
      mode: "managed",
      predefinedLogAnalyticsAvailable: false,
      temporaryLogAnalyticsAuthAvailable: false,
    });
    expect(response.getHeader("cache-control")).toBe("no-store");
    expect(serialized).not.toContain("private-event-hub-secret");
    expect(serialized).not.toContain("private-login-secret");
    expect(serialized).not.toContain("firewall-logs");
  });
});
