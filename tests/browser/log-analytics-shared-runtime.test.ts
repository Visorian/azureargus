import type { LogAnalyticsQueryRequest } from "../../shared/types/logAnalytics";
import { discoverAzureLogAnalyticsAccess } from "../../shared/utils/azureResourceDiscovery";
import { assignStableLogAnalyticsRowIds } from "../../shared/utils/dnsLogAnalyticsQuery";
import { executeLogAnalyticsQuery } from "../../shared/utils/logAnalyticsQuery";

const tenantId = "11111111-1111-4111-8111-111111111111";
const subscriptionId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const STABLE_DNS_ID =
  "la:proxy-structured:d0ba28e4af71a583be012675e52199f7f9e5a16ce4807fd895139dd02a27aafa:1";

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
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

test("shared Azure discovery follows fixed-origin pagination in browser runtime", async () => {
  const nextLink = "https://management.azure.com/tenants?api-version=2022-12-01&skiptoken=next";
  let graphRequestCount = 0;
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const url = requestUrl(input);
    expect(new URL(url).origin).toBe("https://management.azure.com");
    expect(init?.redirect).toBe("error");
    if (url === nextLink) {
      return jsonResponse({ value: [{ displayName: "Tenant", tenantId }] });
    }
    if (url.includes("/tenants?")) {
      return jsonResponse({ nextLink, value: [] });
    }
    if (url.includes("/subscriptions?")) {
      return jsonResponse({ value: [{ displayName: "Subscription", subscriptionId }] });
    }
    graphRequestCount += 1;
    if (graphRequestCount === 1) {
      return jsonResponse({ $skipToken: "next-workspace-page", data: [] });
    }
    if (typeof init?.body !== "string") throw new Error("Expected Resource Graph request body");
    expect(JSON.parse(init.body)).toMatchObject({
      options: { $skipToken: "next-workspace-page" },
    });
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

  expect(access.tenants).toHaveLength(1);
  expect(access.workspaces).toHaveLength(1);
  expect(graphRequestCount).toBe(2);
});

test("shared query maps Azure response and hashes DNS identities with Web Crypto", async () => {
  const rows = [{ TimeGenerated: "2026-07-10T10:00:00.000Z", QueryName: "example.com." }];
  const [assigned] = await assignStableLogAnalyticsRowIds("proxy-structured", rows);
  expect(assigned?.id).toBe(STABLE_DNS_ID);

  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    expect(requestUrl(input)).toBe(
      `https://api.loganalytics.azure.com/v1/workspaces/${workspaceId}/query`,
    );
    expect(init?.redirect).toBe("error");
    return jsonResponse({
      tables: [
        {
          columns: [
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
          ].map((name) => ({ name, type: "string" })),
          rows: [
            [
              "2026-07-10T10:01:00.000Z",
              "AZFWNetworkRule",
              "Allow",
              "TCP",
              "10.0.0.4",
              "50000",
              "10.0.0.5",
              "",
              "443",
              "policy",
              "group",
              "collection",
              "rule",
              "Allow TCP",
            ],
          ],
        },
      ],
    });
  });

  const result = await executeLogAnalyticsQuery({ workspaceId }, createQueryRequest(), "token", {
    fetchImplementation,
    queryId: "browser",
  });

  expect(result.records).toEqual([
    expect.objectContaining({ id: "browser:0:0", message: "Allow TCP" }),
  ]);
});

test("shared browser transport rejects redirected Azure responses", async () => {
  const redirected = jsonResponse({ tables: [] });
  Object.defineProperty(redirected, "redirected", { value: true });
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(redirected);

  await expect(
    executeLogAnalyticsQuery({ workspaceId }, createQueryRequest(), "token", {
      fetchImplementation,
    }),
  ).rejects.toMatchObject({ kind: "upstream" });
  expect(fetchImplementation.mock.calls[0]?.[1]?.redirect).toBe("error");
});

test("shared browser discovery rejects attacker pagination before sending authorization", async () => {
  const attackerUrl = "https://attacker.example/tenants?skiptoken=stolen";
  const fetchImplementation = vi.fn<typeof fetch>(async (input) => {
    const url = requestUrl(input);
    if (url.includes("/tenants?")) {
      return jsonResponse({ nextLink: attackerUrl, value: [] });
    }
    return jsonResponse({ value: [] });
  });

  await expect(
    discoverAzureLogAnalyticsAccess(
      "management-token",
      new AbortController().signal,
      fetchImplementation,
    ),
  ).rejects.toMatchObject({ status: 502 });
  expect(fetchImplementation.mock.calls.map(([input]) => requestUrl(input))).not.toContain(
    attackerUrl,
  );
});

test("shared browser query rejects a wrong-origin final response", async () => {
  const response = jsonResponse({ tables: [] });
  Object.defineProperty(response, "url", {
    value: "https://attacker.example/query",
  });
  const fetchImplementation = vi.fn<typeof fetch>().mockResolvedValue(response);

  await expect(
    executeLogAnalyticsQuery({ workspaceId }, createQueryRequest(), "token", {
      fetchImplementation,
    }),
  ).rejects.toMatchObject({ kind: "upstream" });
  expect(requestUrl(fetchImplementation.mock.calls[0]![0])).toBe(
    `https://api.loganalytics.azure.com/v1/workspaces/${workspaceId}/query`,
  );
});
