import type { Page, Request } from "@playwright/test";

export const temporaryAzureClientId = "11111111-1111-4111-8111-111111111111";
export const temporaryAzureTenantId = "22222222-2222-4222-8222-222222222222";
export const temporaryAzureSubscriptionId = "33333333-3333-4333-8333-333333333333";
export const temporaryAzureWorkspaceId = "44444444-4444-4444-8444-444444444444";

const managementToken = "temporary-management-token";
const logAnalyticsToken = "temporary-log-analytics-token";
const resourceId =
  "/subscriptions/33333333-3333-4333-8333-333333333333/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub";

export interface TemporaryAzureRequest {
  authorization: string | null;
  body: string | null;
  method: string;
  origin: string;
  pathname: string;
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jwt(claims: Record<string, unknown>) {
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(claims)}.`;
}

function azureResponse(columns: string[], rows: unknown[][]) {
  return {
    tables: [
      {
        name: "PrimaryResult",
        columns: columns.map((name) => ({ name, type: "string" })),
        rows,
      },
    ],
  };
}

function firewallResponse() {
  return azureResponse(
    [
      "TimeGenerated",
      "Category",
      "Action",
      "Protocol",
      "SourceIp",
      "SourcePort",
      "DestinationIp",
      "DestinationFqdn",
      "DestinationPort",
      "Policy",
      "RuleCollectionGroup",
      "RuleCollection",
      "Rule",
      "Message",
    ],
    [
      [
        "2026-07-10T10:01:00.000Z",
        "AZFWNetworkRule",
        "Allow",
        "UDP",
        "10.0.0.4",
        "52338",
        "10.0.0.53",
        "",
        "53",
        "policy",
        "group",
        "collection",
        "dns",
        "temporary direct query record",
      ],
    ],
  );
}

function dnsResponse(query: string) {
  if (query.includes("SampleCount")) {
    return azureResponse(["TableExists", "SampleCount"], [[true, 2]]);
  }
  if (query.startsWith("AZFWDnsQuery")) {
    return azureResponse(
      [
        "TimeGenerated",
        "Category",
        "ResourceId",
        "SourceIp",
        "SourcePort",
        "QueryId",
        "QueryType",
        "QueryClass",
        "QueryName",
        "Protocol",
        "ResponseCode",
        "ResponseFlags",
        "RequestDurationSecs",
      ],
      [
        [
          "2026-07-10T10:01:00.000Z",
          "AZFWDnsQuery",
          resourceId,
          "10.0.0.4",
          "52338",
          "22213",
          "AAAA",
          "IN",
          "example.com.",
          "UDP",
          "NOERROR",
          "qr,rd,ra",
          0.011,
        ],
      ],
    );
  }
  return azureResponse(["TimeGenerated"], []);
}

function record(request: Request): TemporaryAzureRequest {
  const url = new URL(request.url());
  return {
    authorization: request.headers().authorization ?? null,
    body: request.postData(),
    method: request.method(),
    origin: url.origin,
    pathname: url.pathname,
  };
}

export async function mockTemporaryAzure(page: Page) {
  const azureRequests: TemporaryAzureRequest[] = [];
  const sameOriginRequests: TemporaryAzureRequest[] = [];
  const nonces = new Map<string, string>();
  let authorizationCode = 0;
  let graphPage = 0;

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
      sameOriginRequests.push(record(request));
    }
  });

  await page.context().route("https://login.microsoftonline.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          ...corsHeaders,
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
        },
      });
      return;
    }

    if (url.pathname.endsWith("/oauth2/v2.0/authorize")) {
      const redirectUri = url.searchParams.get("redirect_uri");
      const state = url.searchParams.get("state");
      if (!redirectUri || !state) throw new Error("Expected MSAL authorization parameters");
      const code = `temporary-code-${++authorizationCode}`;
      nonces.set(code, url.searchParams.get("nonce") ?? "");
      const redirect = new URL(redirectUri);
      redirect.searchParams.set("code", code);
      redirect.searchParams.set(
        "client_info",
        encode({ uid: "temporary-user", utid: temporaryAzureTenantId }),
      );
      redirect.searchParams.set("session_state", "temporary-session");
      redirect.searchParams.set("state", state);
      await route.fulfill({ status: 302, headers: { location: redirect.toString() } });
      return;
    }

    if (url.pathname.endsWith("/oauth2/v2.0/token")) {
      const body = new URLSearchParams(request.postData() ?? "");
      const scope = body.get("scope") ?? "";
      const code = body.get("code");
      const now = Math.floor(Date.now() / 1_000);
      const scopes = new Set(scope.split(" "));
      const response: Record<string, unknown> = {
        access_token: scopes.has("https://api.loganalytics.io/Data.Read")
          ? logAnalyticsToken
          : managementToken,
        client_info: encode({ uid: "temporary-user", utid: temporaryAzureTenantId }),
        expires_in: 3_600,
        ext_expires_in: 3_600,
        refresh_token: "temporary-refresh-token",
        scope,
        token_type: "Bearer",
      };
      if (code) {
        response.id_token = jwt({
          aud: temporaryAzureClientId,
          exp: now + 3_600,
          iat: now,
          iss: `https://login.microsoftonline.com/${temporaryAzureTenantId}/v2.0`,
          name: "Temporary User",
          nbf: now,
          nonce: nonces.get(code),
          oid: "55555555-5555-4555-8555-555555555555",
          preferred_username: "temporary@example.com",
          sub: "temporary-user",
          tid: temporaryAzureTenantId,
          ver: "2.0",
        });
      }
      await route.fulfill({ headers: corsHeaders, json: response });
      return;
    }

    if (url.pathname.endsWith("/.well-known/openid-configuration")) {
      const authority = `https://login.microsoftonline.com/${temporaryAzureTenantId}/oauth2/v2.0`;
      await route.fulfill({
        headers: corsHeaders,
        json: {
          authorization_endpoint: `${authority}/authorize`,
          end_session_endpoint: `https://login.microsoftonline.com/${temporaryAzureTenantId}/oauth2/v2.0/logout`,
          issuer: `https://login.microsoftonline.com/${temporaryAzureTenantId}/v2.0`,
          jwks_uri: `https://login.microsoftonline.com/${temporaryAzureTenantId}/discovery/v2.0/keys`,
          token_endpoint: `${authority}/token`,
        },
      });
      return;
    }

    if (url.pathname === "/common/discovery/instance") {
      await route.fulfill({
        headers: corsHeaders,
        json: {
          metadata: [
            {
              aliases: ["login.microsoftonline.com", "login.windows.net"],
              preferred_cache: "login.windows.net",
              preferred_network: "login.microsoftonline.com",
            },
          ],
          tenant_discovery_endpoint: `https://login.microsoftonline.com/${temporaryAzureTenantId}/v2.0/.well-known/openid-configuration`,
        },
      });
      return;
    }

    throw new Error(`Unexpected Microsoft identity request: ${request.method()} ${url}`);
  });

  await page.route("https://management.azure.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-origin": "*",
        },
      });
      return;
    }
    azureRequests.push(record(request));
    if (url.pathname === "/tenants") {
      const nextPage = url.searchParams.get("skiptoken") === "next";
      await route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: nextPage
          ? {
              value: [
                {
                  defaultDomain: "temporary.example",
                  displayName: "Temporary tenant",
                  tenantId: temporaryAzureTenantId,
                },
              ],
            }
          : {
              nextLink:
                "https://management.azure.com/tenants?api-version=2022-12-01&skiptoken=next",
              value: [],
            },
      });
      return;
    }
    if (url.pathname === "/subscriptions") {
      await route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json: {
          value: [
            { displayName: "Temporary subscription", subscriptionId: temporaryAzureSubscriptionId },
          ],
        },
      });
      return;
    }
    if (url.pathname === "/providers/Microsoft.ResourceGraph/resources") {
      graphPage += 1;
      await route.fulfill({
        headers: { "access-control-allow-origin": "*" },
        json:
          graphPage === 1
            ? { $skipToken: "next-page", data: [] }
            : {
                data: [
                  {
                    location: "westeurope",
                    name: "temporary-workspace",
                    resourceGroup: "network",
                    subscriptionId: temporaryAzureSubscriptionId,
                    workspaceId: temporaryAzureWorkspaceId,
                  },
                ],
              },
      });
      return;
    }
    throw new Error(`Unexpected Azure management request: ${request.method()} ${url}`);
  });

  await page.route("https://api.loganalytics.azure.com/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-headers": "authorization, content-type",
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-origin": "*",
        },
      });
      return;
    }
    azureRequests.push(record(request));
    const body = request.postDataJSON() as { query?: unknown };
    const query = typeof body.query === "string" ? body.query : "";
    const response = query.includes("withsource=Category")
      ? firewallResponse()
      : dnsResponse(query);
    await route.fulfill({ headers: { "access-control-allow-origin": "*" }, json: response });
  });

  return { azureRequests, sameOriginRequests };
}

export const temporaryAzureTokens = {
  logAnalytics: logAnalyticsToken,
  management: managementToken,
};
