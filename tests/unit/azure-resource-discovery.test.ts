import { discoverAzureLogAnalyticsAccess } from "../../server/utils/azureResourceDiscovery";

const tenantId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const deniedSubscriptionId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "44444444-4444-4444-8444-444444444444";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") {
    return input;
  }
  return input instanceof URL ? input.href : input.url;
}

function parseRequestBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") {
    throw new Error("Expected JSON request body");
  }
  return JSON.parse(body) as unknown;
}

function readOptions(value: unknown) {
  return typeof value === "object" && value !== null && "options" in value
    ? value.options
    : undefined;
}

describe("Azure Log Analytics access discovery", () => {
  it("maps accessible tenants and workspace customer IDs from ARM", async () => {
    let graphRequest: RequestInit | undefined;
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/tenants?")) {
        return jsonResponse({
          value: [
            {
              defaultDomain: "target.example",
              displayName: "Target tenant",
              tenantId,
            },
            { displayName: "Malformed tenant", tenantId: "not-a-tenant" },
          ],
        });
      }
      if (url.includes("/subscriptions?")) {
        return jsonResponse({
          value: [
            { displayName: "Production", subscriptionId },
            { displayName: "Denied", subscriptionId: deniedSubscriptionId },
          ],
        });
      }
      if (url.includes("/providers/Microsoft.ResourceGraph/resources?")) {
        graphRequest = init;
        return jsonResponse({
          data: [
            {
              location: "westeurope",
              name: "firewall-logs",
              resourceGroup: "firewall",
              subscriptionId,
              workspaceId,
            },
            {
              name: "missing-customer-id",
              subscriptionId,
            },
          ],
        });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    await expect(
      discoverAzureLogAnalyticsAccess(
        "management-token",
        new AbortController().signal,
        fetchImplementation,
      ),
    ).resolves.toEqual({
      tenants: [
        {
          defaultDomain: "target.example",
          displayName: "Target tenant",
          tenantId,
        },
      ],
      workspaces: [
        {
          location: "westeurope",
          name: "firewall-logs",
          resourceGroup: "firewall",
          subscriptionId,
          subscriptionName: "Production",
          workspaceId,
        },
      ],
    });
    expect(graphRequest?.method).toBe("POST");
    expect(graphRequest?.headers).toEqual(
      expect.objectContaining({ authorization: "Bearer management-token" }),
    );
    expect(parseRequestBody(graphRequest?.body)).toMatchObject({
      subscriptions: [subscriptionId, deniedSubscriptionId],
    });
  });

  it("follows only management.azure.com pagination links", async () => {
    const secondPage = "https://management.azure.com/tenants?api-version=2022-12-01&skiptoken=next";
    const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
      const url = requestUrl(input);
      if (url === secondPage) {
        return jsonResponse({ value: [{ displayName: "Target", tenantId }] });
      }
      if (url.includes("/tenants?")) {
        return jsonResponse({ nextLink: secondPage, value: [] });
      }
      return jsonResponse({ value: [] });
    });

    const access = await discoverAzureLogAnalyticsAccess(
      "management-token",
      new AbortController().signal,
      fetchImplementation,
    );

    expect(access.tenants).toHaveLength(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("follows Resource Graph skip tokens", async () => {
    let graphRequest = 0;
    const graphBodies: unknown[] = [];
    const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
      const url = requestUrl(input);
      if (url.includes("/tenants?")) {
        return jsonResponse({ value: [{ displayName: "Target", tenantId }] });
      }
      if (url.includes("/subscriptions?")) {
        return jsonResponse({ value: [{ displayName: "Production", subscriptionId }] });
      }
      graphRequest += 1;
      graphBodies.push(parseRequestBody(init?.body));
      if (graphRequest === 1) {
        return jsonResponse({ $skipToken: "next-page", data: [] });
      }
      return jsonResponse({
        data: [
          {
            location: "westeurope",
            name: "firewall-logs",
            resourceGroup: "firewall",
            subscriptionId,
            workspaceId,
          },
        ],
      });
    });

    const access = await discoverAzureLogAnalyticsAccess(
      "management-token",
      new AbortController().signal,
      fetchImplementation,
    );

    expect(access.workspaces).toHaveLength(1);
    expect(graphRequest).toBe(2);
    expect(readOptions(graphBodies[0])).toBeUndefined();
    expect(readOptions(graphBodies[1])).toEqual({ $skipToken: "next-page" });
  });

  it("rejects unauthorized ARM access", async () => {
    const fetchImplementation = vi.fn<typeof fetch>(async () => jsonResponse({}, 401));

    await expect(
      discoverAzureLogAnalyticsAccess(
        "management-token",
        new AbortController().signal,
        fetchImplementation,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
