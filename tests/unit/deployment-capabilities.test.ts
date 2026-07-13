import { parseDeploymentCapabilities } from "../../server/utils/deploymentCapabilities";

const validOidcEnvironment = {
  NUXT_OIDC_AUTH_SESSION_SECRET: "a".repeat(32),
  NUXT_OIDC_SESSION_SECRET: "s".repeat(48),
  NUXT_OIDC_TOKEN_KEY: Buffer.alloc(32).toString("base64"),
};

const validOidc = {
  providers: {
    entra: {
      authorizationUrl: "https://login.example.com/authorize",
      clientId: "11111111-1111-4111-8111-111111111111",
      clientSecret: "login-secret",
      redirectUri: "https://app.example.com/auth/entra/callback",
      tokenUrl: "https://login.example.com/token",
    },
  },
};

const validEventHub = {
  connectionString:
    "Endpoint=sb://namespace.servicebus.windows.net/;SharedAccessKeyName=reader;SharedAccessKey=event-hub-secret;EntityPath=firewall-logs",
  name: "",
};

const validLogAnalytics = {
  tenantId: "22222222-2222-4222-8222-222222222222",
  clientId: "33333333-3333-4333-8333-333333333333",
  clientSecret: "log-analytics-secret",
  workspaceId: "44444444-4444-4444-8444-444444444444",
};

function parse(runtimeConfig: unknown) {
  return parseDeploymentCapabilities(runtimeConfig, validOidcEnvironment);
}

describe("deployment capabilities", () => {
  it("uses anonymous mode when all data-source configuration is absent", () => {
    expect(parse({})).toEqual({
      mode: "anonymous",
      eventHubAvailable: false,
      predefinedLogAnalyticsAvailable: false,
      temporaryLogAnalyticsAuthAvailable: false,
      errors: [],
    });
  });

  it("enables only temporary Log Analytics auth for complete public delegated configuration", () => {
    expect(
      parse({
        public: {
          logAnalyticsDelegated: {
            tenantId: "55555555-5555-4555-8555-555555555555",
            clientId: "66666666-6666-4666-8666-666666666666",
          },
        },
      }),
    ).toEqual({
      mode: "anonymous",
      eventHubAvailable: false,
      predefinedLogAnalyticsAvailable: false,
      temporaryLogAnalyticsAuthAvailable: true,
      errors: [],
    });
  });

  it.each([
    [
      "Event Hub",
      { eventHub: validEventHub, oidc: validOidc },
      { eventHubAvailable: true, predefinedLogAnalyticsAvailable: false },
    ],
    [
      "Log Analytics",
      { logAnalytics: validLogAnalytics, oidc: validOidc },
      { eventHubAvailable: false, predefinedLogAnalyticsAvailable: true },
    ],
    [
      "both predefined sources",
      { eventHub: validEventHub, logAnalytics: validLogAnalytics, oidc: validOidc },
      { eventHubAvailable: true, predefinedLogAnalyticsAvailable: true },
    ],
  ])("uses managed mode for complete %s configuration", (_label, runtimeConfig, availability) => {
    expect(parse(runtimeConfig)).toMatchObject({
      mode: "managed",
      ...availability,
      temporaryLogAnalyticsAuthAvailable: false,
      errors: [],
    });
  });

  it.each([
    ["Event Hub", { eventHub: { name: "firewall-logs" }, oidc: validOidc }, "event_hub_incomplete"],
    [
      "Log Analytics",
      {
        logAnalytics: { tenantId: validLogAnalytics.tenantId },
        oidc: validOidc,
      },
      "log_analytics_incomplete",
    ],
    [
      "delegated Log Analytics",
      {
        public: { logAnalyticsDelegated: { tenantId: validLogAnalytics.tenantId } },
      },
      "delegated_log_analytics_incomplete",
    ],
  ])("fails closed for partial %s configuration", (_label, runtimeConfig, errorCode) => {
    const result = parse(runtimeConfig);

    expect(result).toMatchObject({
      mode: "invalid",
      eventHubAvailable: false,
      predefinedLogAnalyticsAvailable: false,
      temporaryLogAnalyticsAuthAvailable: false,
    });
    expect(result.errors).toContainEqual(expect.objectContaining({ code: errorCode }));
  });

  it.each([
    [
      "Event Hub",
      {
        eventHub: {
          ...validEventHub,
          connectionString:
            "Endpoint=https://namespace.servicebus.windows.net/;SharedAccessKeyName=reader;SharedAccessKey=secret;EntityPath=firewall-logs",
        },
        oidc: validOidc,
      },
      "event_hub_invalid",
    ],
    [
      "delegated Log Analytics",
      {
        public: {
          logAnalyticsDelegated: {
            tenantId: "not-a-tenant-id",
            clientId: "not-a-client-id",
          },
        },
      },
      "delegated_log_analytics_invalid",
    ],
    [
      "predefined Log Analytics",
      {
        logAnalytics: {
          ...validLogAnalytics,
          tenantId: "not-a-tenant-id",
          workspaceId: "not-a-workspace-id",
        },
        oidc: validOidc,
      },
      "log_analytics_invalid",
    ],
    [
      "OIDC",
      {
        eventHub: validEventHub,
        oidc: {
          providers: {
            entra: { ...validOidc.providers.entra, redirectUri: "javascript:alert(1)" },
          },
        },
      },
      "oidc_invalid",
    ],
  ])("fails closed for malformed %s configuration", (_label, runtimeConfig, errorCode) => {
    const result = parse(runtimeConfig);

    expect(result.mode).toBe("invalid");
    expect(result.errors).toContainEqual(expect.objectContaining({ code: errorCode }));
  });

  it("fails closed when a valid predefined source is mixed with invalid delegated configuration", () => {
    const result = parse({
      eventHub: validEventHub,
      oidc: validOidc,
      public: { logAnalyticsDelegated: { clientId: "not-a-client-id" } },
    });

    expect(result).toMatchObject({
      mode: "invalid",
      eventHubAvailable: false,
      predefinedLogAnalyticsAvailable: false,
      temporaryLogAnalyticsAuthAvailable: false,
    });
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: "delegated_log_analytics_incomplete" }),
    );
  });

  it("never serializes private or public configuration values in its output", () => {
    const runtimeConfig = {
      eventHub: validEventHub,
      logAnalytics: validLogAnalytics,
      oidc: validOidc,
      public: {
        logAnalyticsDelegated: {
          tenantId: "55555555-5555-4555-8555-555555555555",
          clientId: "66666666-6666-4666-8666-666666666666",
        },
      },
    };

    const serialized = JSON.stringify(parse(runtimeConfig));
    const forbiddenValues = [
      ...Object.values(validEventHub),
      ...Object.values(validLogAnalytics),
      ...Object.values(validOidc.providers.entra),
      ...Object.values(runtimeConfig.public.logAnalyticsDelegated),
      ...Object.values(validOidcEnvironment),
    ].filter(Boolean);

    for (const value of forbiddenValues) {
      expect(serialized).not.toContain(value);
    }
  });
});
