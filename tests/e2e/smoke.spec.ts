import { resolve } from "node:path";

import { expect, type Locator, type Page, test } from "@playwright/test";

import type { PersistedFirewallLogRecord } from "../../app/utils/logHistoryRecord";
import { EVENT_HUB_CONNECTION_STRING_STORAGE_KEY } from "../../app/utils/eventHubConnectionStorage";

const LOG_HISTORY_STORE_MODULE_URL = `/_nuxt/@fs${resolve("app/utils/logHistoryStore.client.ts")}`;

function createPersistedLog(id: string, timestamp = new Date().toISOString()) {
  return {
    action: "Allow",
    category: "AZFWNetworkRule",
    id,
    message: id,
    protocol: "TCP",
    searchableText: id,
    timestamp,
  } satisfies PersistedFirewallLogRecord;
}

async function appendLogHistory(
  page: Page,
  records: readonly PersistedFirewallLogRecord[] = [createPersistedLog(`seed-${Date.now()}`)],
) {
  await page.evaluate(
    async ({ moduleUrl, records: nextRecords }) => {
      const store = await import(moduleUrl);
      await store.appendLogHistoryBatch(nextRecords, {
        maxAgeMs: 24 * 60 * 60 * 1_000,
        maxRecords: 100_000,
      });
    },
    { moduleUrl: LOG_HISTORY_STORE_MODULE_URL, records },
  );
}

async function queryLogHistoryIds(page: Page) {
  return page.evaluate(
    async ({ moduleUrl }) => {
      const store = await import(moduleUrl);
      const records = await store.queryLogHistoryRange({ limit: 100_000 });
      return records.map((record: PersistedFirewallLogRecord) => record.id);
    },
    { moduleUrl: LOG_HISTORY_STORE_MODULE_URL },
  );
}

async function enterAnonymousMode(page: Page) {
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByRole("region", { name: "Data source" })).toBeVisible();
}

async function openSettings(page: Page) {
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  const settingsDrawer = page.locator("#logs-settings-drawer");
  if ((await settingsButton.getAttribute("aria-expanded")) !== "true") {
    await settingsButton.click();
  }
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await expect(settingsDrawer).toBeVisible();
  return settingsDrawer;
}

async function expectAlignedColumns(header: Locator, row: Locator) {
  await expect(async () => {
    const [headerCells, rowCells] = await Promise.all([
      header.locator(":scope > *").evaluateAll((cells) =>
        cells.map((cell) => {
          const { width, x } = cell.getBoundingClientRect();
          return { width, x };
        }),
      ),
      row.locator(":scope > *").evaluateAll((cells) =>
        cells.map((cell) => {
          const { width, x } = cell.getBoundingClientRect();
          return { width, x };
        }),
      ),
    ]);

    expect(rowCells).toHaveLength(headerCells.length);
    for (const [index, headerCell] of headerCells.entries()) {
      expect(Math.abs(rowCells[index]!.x - headerCell.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(rowCells[index]!.width - headerCell.width)).toBeLessThanOrEqual(1);
    }
  }).toPass();
}

async function expectNoHorizontalOverflow(cell: Locator) {
  await expect
    .poll(() => cell.evaluate((element) => element.scrollWidth - element.clientWidth))
    .toBeLessThanOrEqual(1);
}

async function expectLeftInSameRow(left: Locator, right: Locator) {
  await expect(async () => {
    const [leftBox, rightBox] = await Promise.all([left.boundingBox(), right.boundingBox()]);
    expect(leftBox).not.toBeNull();
    expect(rightBox).not.toBeNull();
    const leftCenter = leftBox!.y + leftBox!.height / 2;
    const rightCenter = rightBox!.y + rightBox!.height / 2;
    expect(Math.abs(leftCenter - rightCenter)).toBeLessThanOrEqual(1);
    expect(leftBox!.x + leftBox!.width).toBeLessThan(rightBox!.x);
  }).toPass();
}

async function expectRightAligned(container: Locator, item: Locator) {
  await expect(async () => {
    const [containerBox, itemBox] = await Promise.all([
      container.boundingBox(),
      item.boundingBox(),
    ]);
    expect(containerBox).not.toBeNull();
    expect(itemBox).not.toBeNull();
    const rightInset = containerBox!.x + containerBox!.width - itemBox!.x - itemBox!.width;
    expect(rightInset).toBeGreaterThanOrEqual(15);
    expect(rightInset).toBeLessThanOrEqual(17);
  }).toPass();
}

async function expectMatchingOuterEdges(
  topLeft: Locator,
  topRight: Locator,
  bottomLeft: Locator,
  bottomRight: Locator,
) {
  await expect(async () => {
    const [topLeftBox, topRightBox, bottomLeftBox, bottomRightBox] = await Promise.all([
      topLeft.boundingBox(),
      topRight.boundingBox(),
      bottomLeft.boundingBox(),
      bottomRight.boundingBox(),
    ]);
    expect(topLeftBox).not.toBeNull();
    expect(topRightBox).not.toBeNull();
    expect(bottomLeftBox).not.toBeNull();
    expect(bottomRightBox).not.toBeNull();
    expect(Math.abs(topLeftBox!.x - bottomLeftBox!.x)).toBeLessThanOrEqual(1);
    expect(
      Math.abs(topRightBox!.x + topRightBox!.width - bottomRightBox!.x - bottomRightBox!.width),
    ).toBeLessThanOrEqual(1);
  }).toPass();
}

async function mockManagedDeployment(
  page: Page,
  availability: { eventHub: boolean; logAnalytics: boolean },
) {
  await page.route("**/api/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        mode: "managed",
        eventHubAvailable: availability.eventHub,
        predefinedLogAnalyticsAvailable: availability.logAnalytics,
        temporaryLogAnalyticsAuthAvailable: false,
        errors: [],
      },
    });
  });
  await page.route("**/api/_auth/session", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        expireAt: Math.floor(Date.now() / 1_000) + 3_600,
        name: "Managed User",
        provider: "entra",
      },
    });
  });
}

async function seedVisibleLog(page: Page, destinationIp: string) {
  await page.evaluate((nextDestinationIp) => {
    const nuxtApp = window.useNuxtApp?.();
    if (!nuxtApp) {
      throw new Error("Nuxt app is unavailable");
    }
    nuxtApp.payload.state["$sfirewall-log-records"] = [
      {
        action: "Allow",
        category: "AZFWNetworkRule",
        destinationIp: nextDestinationIp,
        id: "geoip-row",
        message: `Allow TCP to ${nextDestinationIp}`,
        protocol: "TCP",
        raw: {},
        searchableText: `azfwnetworkrule allow tcp ${nextDestinationIp}`,
        timestamp: "2026-07-12T14:30:00.000Z",
      },
    ];
    nuxtApp.payload.state["$sevent-hub-received-count"] = 1;
  }, destinationIp);
}

async function seedDetailLog(page: Page, destinationIp = "20.30.40.50", protocol = "TCP") {
  await page.evaluate(
    ({ nextDestinationIp, nextProtocol }) => {
      const nuxtApp = window.useNuxtApp?.();
      if (!nuxtApp) {
        throw new Error("Nuxt app is unavailable");
      }
      nuxtApp.payload.state["$sfirewall-log-records"] = [
        {
          action: "Deny",
          category: "AZFWNetworkRule",
          destinationIp: nextDestinationIp,
          destinationPort: "443",
          enqueuedTimeUtc: "2026-07-12T16:37:56.822Z",
          id: "detail-row",
          message: "detail-record",
          partitionId: "0",
          policy: "hub-policy",
          protocol: nextProtocol,
          raw: { detail: true },
          rule: "deny-web",
          ruleCollection: "blocked",
          ruleCollectionGroup: "hub-collection-group",
          searchableText: "detail-record",
          sequenceNumber: "5234806",
          sourceIp: "10.140.16.133",
          sourcePort: "15213",
          timestamp: "2026-07-12T16:36:42.015Z",
        },
      ];
      nuxtApp.payload.state["$sevent-hub-received-count"] = 1;
    },
    { nextDestinationIp: destinationIp, nextProtocol: protocol },
  );
}

test("anonymous deployment bypasses application login", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText("Temporary session")).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave" })).toHaveCount(0);
});

test("anonymous deployment starts directly in logs", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText("Temporary session")).toBeVisible();

  const darkModeToggle = page.getByRole("button", { name: "Switch to dark mode" });
  await expect(darkModeToggle).toBeVisible();
  await darkModeToggle.click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("button", { name: "Switch to light mode" })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("managed deployment requires application login", async ({ page }) => {
  await page.route("**/api/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        mode: "managed",
        eventHubAvailable: true,
        predefinedLogAnalyticsAvailable: false,
        temporaryLogAnalyticsAuthAvailable: false,
        errors: [],
      },
    });
  });

  await page.goto("/logs");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign in with Entra" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use without login" })).toHaveCount(0);
});

test("managed Event Hub uses configured server stream without exposing credentials", async ({
  page,
}) => {
  await mockManagedDeployment(page, { eventHub: true, logAnalytics: true });
  await page.route("**/api/event-hub/stream", async (route) => {
    const requestBody = route.request().postDataJSON();
    expect(requestBody).toEqual({ consumerGroup: "$Default", lookbackMinutes: 15 });
    expect(JSON.stringify(requestBody)).not.toContain("connectionString");
    await route.fulfill({
      body: `${JSON.stringify({
        type: "events",
        events: [
          {
            body: {
              records: [
                {
                  Action: "Allow",
                  Category: "AZFWNetworkRule",
                  msg: "managed-stream-record",
                  Protocol: "TCP",
                  TimeGenerated: "2026-07-12T14:30:00.000Z",
                },
                {
                  category: "AzureFirewallDnsProxy",
                  operationName: "AzureFirewallDnsProxyLog",
                  properties: {
                    msg: "DNS Request: 10.140.16.133:29135 - 50772 A IN winatp-gw-neu3.microsoft.com. udp 57 false 1232 NOERROR qr,rd,ra 336 0.0032s",
                  },
                  time: "2026-07-12T14:30:00.500Z",
                },
              ],
            },
            enqueuedTimeUtc: "2026-07-12T14:30:01.000Z",
            partitionId: "0",
            sequenceNumber: 42,
          },
        ],
      })}\n`,
      contentType: "application/x-ndjson",
    });
  });

  await page.goto("/logs");
  await expect(page.getByText("Managed User")).toBeVisible();
  const settingsDrawer = await openSettings(page);
  await expect(page.getByRole("textbox", { name: "Connection string" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Event Hub name" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Remember connection string" })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByText("2 visible / 2 received")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Event Hub settings" })).toHaveCount(0);
  await expect(
    page.getByRole("row", { name: /Jul 12, 2026.*AZFWNetworkRule.*Allow.*TCP/ }),
  ).toBeVisible();
  const firewallTable = page.getByRole("table", { name: "Firewall logs" });
  const tableBox = await firewallTable.boundingBox();
  expect(tableBox?.x).toBeGreaterThanOrEqual(15);
  await expect(firewallTable).toHaveCSS("border-top-width", "1px");
  await expect(firewallTable).toHaveCSS("border-radius", "6px");

  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  await expect(
    page
      .getByRole("group", { name: "DNS troubleshooting status and actions" })
      .getByText("1 queried entries · 0 unidentified transports"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Open DNS details for winatp-gw-neu3.microsoft.com.",
    }),
  ).toBeVisible();
});

test("managed Log Analytics-only deployment shows normalized AzureDiagnostics rows", async ({
  page,
}) => {
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true });
  await page.route("**/api/log-analytics/dns/readiness", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        readiness: [
          {
            source: "network-rule",
            storage: "resource-specific",
            status: "missing",
            sampleCount: null,
          },
          {
            source: "network-rule",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
        ],
      },
    });
  });
  await page.route("**/api/log-analytics/query", async (route) => {
    const requestBody = route.request().postDataJSON();
    expect(requestBody).not.toHaveProperty("workspaceId");
    expect(requestBody.limit).toBe(2_000);
    expect(requestBody.storage).toBe("azure-diagnostics");
    await route.fulfill({
      contentType: "application/json",
      json: {
        limit: 2_000,
        records: [
          {
            action: "Allow",
            category: "AZFWNetworkRule",
            destinationIp: "192.0.2.53",
            destinationPort: "53",
            id: "managed-azure-diagnostics-query-record",
            message: "Allow UDP from 192.0.2.10:53607 to 192.0.2.53:53",
            policy: "policy-1",
            protocol: "UDP",
            raw: { Category: "AZFWNetworkRule" },
            rule: "rule-1",
            ruleCollection: "collection-1",
            ruleCollectionGroup: "group-1",
            searchableText:
              "azfwnetworkrule allow udp 192.0.2.10 53607 192.0.2.53 53 policy-1 group-1 collection-1 rule-1",
            sourceIp: "192.0.2.10",
            sourcePort: "53607",
            timestamp: "2026-07-12T14:30:00.000Z",
          },
        ],
        truncated: false,
      },
    });
  });

  await page.goto("/logs");
  const settingsDrawer = await openSettings(page);
  const dataSource = page.getByRole("group", { name: "Data source" });
  await expect(dataSource.getByRole("button", { name: "Live Event Hub" })).toBeDisabled();
  await expect(dataSource.getByRole("button", { name: "Log Analytics" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Workspace ID*" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect to Azure" })).toHaveCount(0);
  const sourceSelect = page.getByRole("combobox", { name: "Query source" });
  await expect(sourceSelect).toContainText("AzureDiagnostics");
  await expect(sourceSelect).toBeDisabled();
  const runQuery = page.getByRole("button", { name: "Run query" });
  await expect(
    page.getByRole("complementary").getByRole("button", { name: "Run query" }),
  ).toHaveCount(0);
  await expect(runQuery).toBeVisible();
  await page.getByRole("spinbutton", { name: "Query result limit" }).fill("2000");
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await runQuery.click();
  await expect(page.getByText("1 visible", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Log Analytics settings" })).toHaveCount(0);
  const normalizedRow = page
    .getByRole("table", { name: "Firewall logs" })
    .getByRole("row")
    .filter({ hasText: "192.0.2.10" });
  await expect(normalizedRow).toBeVisible();
  await expect(normalizedRow).toContainText("AZFWNetworkRule");
  await expect(normalizedRow).toContainText("Allow");
  await expect(normalizedRow).toContainText("UDP");
  await expect(normalizedRow).toContainText("53607");
  await expect(normalizedRow).toContainText("192.0.2.53");
  await expect(normalizedRow).toContainText("53");
  await expect(normalizedRow).toContainText("rule-1");
});

test("managed DNS lens queries explicitly and shows decoded response size", async ({ page }) => {
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true });
  let readinessRequests = 0;
  let listRequests = 0;
  let detailRequests = 0;
  let releaseDetail!: () => void;
  const detailRelease = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  const observation = {
    id: "dns-query:proxy-structured:0",
    timestamp: "2026-07-12T14:30:00.000Z",
    source: "proxy-structured",
    stage: "proxy-exchange",
    path: "proxy",
    outcome: "response-unknown",
    resourceId:
      "/subscriptions/11111111-1111-4111-8111-111111111111/resourceGroups/network/providers/Microsoft.Network/azureFirewalls/hub",
    queryName: "example.com.",
    queryId: "22213",
    queryType: "AAAA",
    queryClass: "IN",
    clientIp: "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255",
    clientPort: "65535",
    protocol: "UDP",
    requestSizeBytes: 57,
    responseSizeBytes: 300,
    responseCode: "NOERROR",
    responseFlags: ["qr", "rd", "ra"],
    durationSeconds: 0.011877665,
    parseState: "parsed",
    warnings: [],
    raw: { ResponseSize: 300 },
  };
  const selector = {
    source: "proxy-structured",
    resourceId: observation.resourceId,
    timestamp: observation.timestamp,
    queryId: observation.queryId,
    queryName: observation.queryName,
    clientIp: observation.clientIp,
    clientPort: observation.clientPort,
  };
  const transportObservation = {
    id: "dns-transport:network-rule:0",
    timestamp: "2026-07-12T14:29:00.000Z",
    logAnalyticsStorage: "azure-diagnostics",
    source: "network-rule",
    stage: "transport",
    path: "direct",
    outcome: "transport-observed",
    clientIp: "ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.254",
    clientPort: "65535",
    serverIp: "168.63.129.16",
    serverPort: "53",
    protocol: "UDP",
    parseState: "parsed",
    warnings: [],
    raw: {},
  };

  await page.route("**/api/log-analytics/dns/readiness", async (route) => {
    readinessRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      json: {
        readiness: [
          {
            source: "proxy-structured",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "proxy-structured",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "dns-flow-trace",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "dns-flow-trace",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "internal-fqdn-failure",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "internal-fqdn-failure",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "network-rule",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "network-rule",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "application-rule",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "application-rule",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "flow-trace",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "flow-trace",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "nat-rule",
            storage: "resource-specific",
            status: "success",
            sampleCount: 2,
          },
          {
            source: "nat-rule",
            storage: "azure-diagnostics",
            status: "success",
            sampleCount: 2,
          },
        ],
      },
    });
  });

  await page.route("**/api/log-analytics/dns/list", async (route) => {
    listRequests += 1;
    const partialResult = listRequests === 1;
    const requestBody = route.request().postDataJSON();
    expect(requestBody).not.toHaveProperty("workspaceId");
    expect(requestBody).toMatchObject({
      filters: {
        search: "",
        queryType: "",
        client: "",
        protocol: "",
        outcome: "",
        source: "",
      },
      limit: 1_000,
      storage: "resource-specific",
    });
    await route.fulfill({
      contentType: "application/json",
      json: {
        queriedEntries: [
          {
            id: "dns-query:proxy-structured:0",
            timestamp: observation.timestamp,
            queryName: observation.queryName,
            queryType: observation.queryType,
            client: `${observation.clientIp}:${observation.clientPort}`,
            protocol: observation.protocol,
            path: observation.path,
            outcome: observation.outcome,
            durationSeconds: observation.durationSeconds,
            observationCount: 1,
            completeness: "complete",
            confidence: "uncorrelated",
            source: observation.source,
            warnings: [],
            observations: [observation],
            detailSelector: selector,
          },
          {
            id: "dns-query:proxy-structured:1",
            timestamp: "2026-07-12T14:20:00.000Z",
            queryName: "older.example.com.",
            queryType: "A",
            client: "10.0.0.4:53000",
            protocol: "UDP",
            path: "proxy",
            outcome: "response-unknown",
            durationSeconds: 0.02,
            observationCount: 1,
            completeness: "complete",
            confidence: "uncorrelated",
            source: "proxy-structured",
            warnings: [],
            observations: [],
          },
        ],
        transportObservations: partialResult ? [] : [transportObservation],
        queriedEntriesTruncated: false,
        transportObservationsTruncated: false,
        sources: partialResult
          ? [
              { source: "proxy-structured", availability: "available", truncated: false },
              { source: "dns-flow-trace", availability: "available", truncated: false },
              { source: "internal-fqdn-failure", availability: "available", truncated: false },
              {
                source: "network-rule",
                availability: "failed",
                truncated: false,
                warning: "DNS transport query failed",
              },
            ]
          : [
              { source: "proxy-structured", availability: "available", truncated: false },
              { source: "dns-flow-trace", availability: "available", truncated: false },
              { source: "internal-fqdn-failure", availability: "available", truncated: false },
              { source: "network-rule", availability: "available", truncated: false },
            ],
      },
    });
  });
  await page.route("**/api/log-analytics/dns/detail", async (route) => {
    detailRequests += 1;
    expect(route.request().postDataJSON()).toEqual({ selector });
    await detailRelease;
    await route.fulfill({
      contentType: "application/json",
      json: {
        observations: [observation],
        detailTruncated: false,
        completeness: "complete",
        warnings: [],
      },
    });
  });

  await page.goto("/logs");
  await expect.poll(() => readinessRequests).toBe(1);
  expect(listRequests).toBe(0);
  await expect(page.getByRole("button", { name: "DNS troubleshooting" })).toBeVisible();
  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  let settingsDrawer = await openSettings(page);
  await expect(page.getByText("Run DNS query to load entries.")).toBeVisible();
  await expect(
    page.getByTestId("log-filter-row").getByRole("button", { name: "Apply filters" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("log-filter-row").getByRole("button", { name: "Reset" }),
  ).toBeVisible();
  await expect(
    page.getByTestId("log-query-row").getByRole("button", { name: "Run query" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Source readiness" })).toBeVisible();
  await expect(page.getByText("Legacy DNS proxy logs", { exact: true })).toHaveCount(0);
  await expect(page.getByText("DNS flow trace logs", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AZFWDnsFlowTrace / AZFWDnsAdditional", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Internal FQDN resolution failures", { exact: true })).toBeVisible();
  await expect(
    page.getByText("AZFWInternalFqdnResolutionFailure / AZFWFqdnResolveFailure", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Network rule logs", { exact: true })).toBeVisible();
  await expect(page.getByText("AZFWNetworkRule · TCP/UDP port 53", { exact: true })).toBeVisible();
  await expect(page.getByText("General firewall logs", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "Dedicated table: available" }).first()).toBeVisible();
  const readinessTable = page.getByRole("table", {
    name: "Source availability in dedicated tables and AzureDiagnostics",
  });
  expect(
    await readinessTable.evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  const sourceSelect = page.getByRole("combobox", { name: "Query source" });
  await expect(sourceSelect).toBeEnabled();
  await expect(sourceSelect).toContainText("Dedicated tables");
  expect(readinessRequests).toBe(1);
  expect(listRequests).toBe(0);
  expect(detailRequests).toBe(0);

  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Run query" }).click();
  expect(readinessRequests).toBe(1);
  const dnsStatusRail = page.getByRole("group", {
    name: "DNS troubleshooting status and actions",
  });
  await expect(
    dnsStatusRail.getByText("2 queried entries · 0 unidentified transports"),
  ).toBeVisible();
  await expect(dnsStatusRail.getByRole("status")).toHaveCount(1);
  await expect.poll(() => listRequests).toBe(1);
  await expect(page.getByText("Response received", { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Some DNS sources could not be queried.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("DNS transport query failed", { exact: true })).toBeVisible();

  settingsDrawer = await openSettings(page);
  await sourceSelect.click();
  await page.getByRole("option", { name: "AzureDiagnostics" }).click();
  await expect(sourceSelect).toContainText("AzureDiagnostics");
  await expect(page.getByText("Run DNS query to load entries.")).toBeVisible();
  expect(listRequests).toBe(1);
  await sourceSelect.click();
  await page.getByRole("option", { name: "Dedicated tables" }).click();
  await expect(sourceSelect).toContainText("Dedicated tables");

  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Run query" }).click();
  expect(readinessRequests).toBe(1);
  await expect.poll(() => listRequests).toBe(2);
  await expect(
    dnsStatusRail.getByText("2 queried entries · 1 unidentified transport"),
  ).toBeVisible();
  await expect(page.getByText("Transport observed", { exact: true })).toHaveCount(0);
  const showUnidentified = page.getByRole("checkbox", {
    name: "Show unidentified DNS transport",
  });
  await showUnidentified.check();
  await expect(page.getByText("Transport observed", { exact: true })).toBeVisible();
  await expect(page.getByText("Not observed", { exact: true })).toBeVisible();
  await expect(
    page
      .locator('section[aria-labelledby="dns-entry-heading"]')
      .getByText("Partial", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("response-unknown", { exact: true })).toHaveCount(0);
  await expect(page.getByText("DNS results may be incomplete", { exact: true })).toHaveCount(0);
  await expect(page.getByText(/could not be queried/)).toHaveCount(0);
  await expect(page.getByText("DNS transport query failed", { exact: true })).toHaveCount(0);

  const resultFilter = page.getByLabel("DNS result");
  await resultFilter.click();
  await expect(page.getByRole("option", { name: "Response received" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Transport observed" })).toBeVisible();
  await page.keyboard.press("Escape");

  const filterControlTops = await page
    .getByTestId("dns-filter-grid")
    .locator(":scope > *")
    .evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().top));
  expect(filterControlTops).toHaveLength(7);
  expect(Math.max(...filterControlTops) - Math.min(...filterControlTops)).toBeLessThanOrEqual(1);

  const entryRows = page
    .locator('section[aria-labelledby="dns-entry-heading"]')
    .getByRole("button", { name: /Open DNS details/ });
  await expect(entryRows.first()).toHaveAccessibleName("Open DNS details for example.com.");
  const sortOrder = page.getByRole("combobox", { name: "DNS sort order" });
  await expect(sortOrder).toContainText("Newest first");
  await sortOrder.click();
  await page.getByRole("option", { name: "Oldest first" }).click();
  await expect(entryRows.first()).toHaveAccessibleName("Open DNS details for older.example.com.");

  const entryHeader = page.getByTestId("dns-entry-header");
  const entryRow = page.getByRole("button", { name: "Open DNS details for example.com." });
  const transportRow = page.getByRole("button", {
    name: "Open DNS transport details for ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.254:65535",
  });

  await expectAlignedColumns(entryHeader, entryRow);
  await expectAlignedColumns(entryHeader, transportRow);
  await expectNoHorizontalOverflow(entryRow.locator(":scope > *").nth(4));
  await expectNoHorizontalOverflow(transportRow.locator(":scope > *").nth(5));

  await page.setViewportSize({ width: 390, height: 812 });
  await transportRow.scrollIntoViewIfNeeded();
  await page.getByTestId("dns-entry-scroll").evaluate((element) => {
    element.scrollLeft = 120;
  });
  await expectAlignedColumns(entryHeader, entryRow);
  await expectAlignedColumns(entryHeader, transportRow);
  await expectNoHorizontalOverflow(entryRow.locator(":scope > *").nth(4));
  await expectNoHorizontalOverflow(transportRow.locator(":scope > *").nth(5));

  await transportRow.click();
  const transportDetail = page.getByRole("dialog", { name: "DNS transport detail" });
  await expect(transportDetail).toBeVisible();
  await expect(transportDetail.getByText("168.63.129.16:53", { exact: true })).toBeVisible();
  await expect.poll(() => detailRequests).toBe(0);
  await page.keyboard.press("Escape");
  await expect(transportRow).toBeFocused();

  await page.getByRole("button", { name: "Open DNS details for example.com." }).click();

  const resolutionDetail = page.getByRole("dialog", { name: "DNS resolution detail" });
  await expect(resolutionDetail).toBeVisible();
  await expect(resolutionDetail.getByText("Loading DNS observations…")).toBeVisible();
  await resolutionDetail.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
  const loadingBox = await resolutionDetail.boundingBox();
  releaseDetail();
  await expect(page.getByText("300 bytes, not TTL")).toBeVisible();
  const loadedBox = await resolutionDetail.boundingBox();
  expect(loadingBox).not.toBeNull();
  expect(loadedBox).not.toBeNull();
  expect(Math.abs(loadedBox!.width - loadingBox!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(loadedBox!.height - loadingBox!.height)).toBeLessThanOrEqual(1);
  await expect(page.getByRole("button", { name: "Copy raw" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Raw message" })).toHaveValue(
    JSON.stringify(observation.raw, null, 2),
  );
  await expect.poll(() => detailRequests).toBe(1);
  await page.keyboard.press("Escape");
  await expect(entryRow).toBeFocused();
});

test("anonymous delegated Log Analytics exposes temporary authentication controls", async ({
  page,
}) => {
  await page.route("**/api/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        mode: "anonymous",
        eventHubAvailable: false,
        predefinedLogAnalyticsAvailable: false,
        temporaryLogAnalyticsAuthAvailable: true,
        errors: [],
      },
    });
  });

  await page.goto("/logs");
  await page.getByRole("button", { name: "Log Analytics" }).click();
  const openLogAnalyticsSettings = page.getByRole("button", {
    name: "Open Log Analytics settings",
  });
  await expect(openLogAnalyticsSettings).toBeVisible();
  await openLogAnalyticsSettings.click();
  const settingsDrawer = page.locator("#logs-settings-drawer");
  await expect(settingsDrawer).toBeVisible();
  await expect(settingsDrawer).toHaveAccessibleName("Log Analytics settings");
  await expect(page.getByText("Tenant ID", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Workspace ID", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Grant tenant consent" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Grant query permission" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Permissions" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect to Azure" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Run query" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Leave" })).toHaveCount(0);
});

test("anonymous mode can reach logs page", async ({ page }) => {
  await page.route("**/api/capabilities", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      json: {
        mode: "anonymous",
        eventHubAvailable: true,
        predefinedLogAnalyticsAvailable: false,
        temporaryLogAnalyticsAuthAvailable: false,
        errors: [],
      },
    });
  });
  await enterAnonymousMode(page);

  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  const settingsDrawer = page.locator("#logs-settings-drawer");
  await expect(settingsButton).toHaveAttribute("aria-expanded", "false");
  await expect(settingsDrawer).toHaveAttribute("aria-hidden", "true");
  await expect(settingsDrawer).toHaveJSProperty("inert", true);
  await expect(settingsDrawer).toBeHidden();
  const dataSource = page.getByRole("group", { name: "Data source" });
  await expect(dataSource).toBeVisible();
  await expect(dataSource.getByRole("button", { name: "Live Event Hub" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dataSource.getByRole("button", { name: "Log Analytics" })).toBeDisabled();
  await expect(
    page.getByText("Temporary Log Analytics app registration is not configured."),
  ).toBeVisible();
  await expect(dataSource.getByText(/visible \/ .*received/)).toHaveCount(0);
  await expect(dataSource.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  await expect(page.getByText(/visible \/ .*received/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  const firewallTable = page.getByRole("table", { name: "Firewall logs" });
  const searchLogs = page.getByRole("textbox", { name: "Search logs" });
  await expect(firewallTable).toBeVisible();
  await searchLogs.fill("dns");
  const tableWidth = await firewallTable.evaluate(
    (element) => element.getBoundingClientRect().width,
  );
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });

  const liveEventHubButton = dataSource.getByRole("button", {
    name: "Live Event Hub",
  });
  await liveEventHubButton.focus();
  await expect(liveEventHubButton).toBeFocused();
  await liveEventHubButton.press("Enter");
  await expect(liveEventHubButton).toBeFocused();

  const openEventHubSettings = page.getByRole("button", {
    name: "Open Event Hub settings",
  });
  await expect(openEventHubSettings).toBeVisible();
  await openEventHubSettings.click();
  const closeSettings = settingsDrawer.getByRole("button", { name: "Close settings" });
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await expect(settingsDrawer).toBeVisible();
  expect(await settingsDrawer.locator("..").evaluate((element) => element.scrollLeft)).toBe(0);
  await expect(settingsDrawer).toHaveAccessibleName("Live Event Hub settings");
  await expect(
    settingsDrawer.getByRole("heading", { name: "Live Event Hub settings" }),
  ).toBeVisible();
  await expect(closeSettings).toBeFocused();
  expect(
    await firewallTable.evaluate((element) => element.getBoundingClientRect().width),
  ).toBeCloseTo(tableWidth, 1);
  await expect(searchLogs).toHaveValue("dns");

  await closeSettings.click();
  await expect(settingsButton).toHaveAttribute("aria-expanded", "false");
  await expect(settingsDrawer).toHaveAttribute("aria-hidden", "true");
  await expect(settingsDrawer).toHaveJSProperty("inert", true);
  await expect(settingsButton).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(settingsDrawer.locator(":focus")).toHaveCount(0);
  await expect(settingsDrawer).toBeHidden();

  await settingsButton.click();
  await expect(closeSettings).toBeFocused();

  const filterDropdowns = page.getByRole("button", { name: "Show popup" });
  await expect(filterDropdowns.filter({ hasText: "Category" })).toBeVisible();
  await expect(filterDropdowns.filter({ hasText: "Action" })).toBeVisible();
  await expect(filterDropdowns.filter({ hasText: "Protocol" })).toBeVisible();

  const lookbackSelect = page.getByRole("combobox", { name: "Lookback" });
  await lookbackSelect.click();
  await expect(page.getByRole("option")).toHaveText([
    "Last 1 minute",
    "Last 3 minutes",
    "Last 5 minutes",
    "Last 10 minutes",
    "Last 15 minutes",
  ]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("option")).toHaveCount(0);
  await expect(settingsDrawer).toBeVisible();
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(settingsDrawer).toBeHidden();
  await expect(settingsButton).toBeFocused();

  await settingsButton.click();
  await expect(settingsDrawer).toBeVisible();
  await settingsButton.click();
  await expect(settingsDrawer).toBeHidden();
  await expect(settingsButton).toBeFocused();

  await openSettings(page);

  const logRetentionSwitch = page.getByRole("switch", {
    name: "Local log retention",
  });
  const logRetentionInfo = page.getByRole("button", {
    name: "About local log retention",
  });
  await expect(logRetentionSwitch).toBeVisible();
  await logRetentionInfo.hover();
  await expect(
    page
      .getByRole("paragraph")
      .filter({ hasText: "Keeps up to 100,000 parsed Live Event Hub records" }),
  ).toBeVisible();
});

test("receiver status indicators follow the active pane actions", async ({ page }) => {
  await enterAnonymousMode(page);
  await page.evaluate(() => {
    const nuxtApp = window.useNuxtApp?.();
    if (!nuxtApp) {
      throw new Error("Nuxt app is unavailable");
    }
    nuxtApp.payload.state["$sevent-hub-status"] = "paused";
    nuxtApp.payload.state["$sevent-hub-latest-source-timestamp"] = "2026-07-13T12:00:00.000Z";
    nuxtApp.payload.state["$sevent-hub-caught-up"] = false;
  });

  const dataSource = page.getByRole("region", { name: "Data source" });
  await expect(dataSource.getByRole("status")).toHaveCount(0);
  await expect(dataSource.getByText("Catching up", { exact: true })).toHaveCount(0);

  const allLogsControls = page.getByRole("group", { name: "All logs status and actions" });
  await expect(allLogsControls.getByRole("status")).toHaveText("paused");
  await expect(allLogsControls.getByText("Catching up", { exact: true })).toBeVisible();
  await expectLeftInSameRow(
    allLogsControls.getByRole("status"),
    allLogsControls.getByRole("button", { name: "Resume" }),
  );

  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  await expect(allLogsControls).toHaveCount(0);
  const dnsControls = page.getByRole("group", {
    name: "DNS troubleshooting status and actions",
  });
  await expect(dnsControls.getByRole("status")).toHaveText("paused");
  await expect(dnsControls.getByText("Catching up", { exact: true })).toBeVisible();
  await expectLeftInSameRow(
    dnsControls.getByRole("status"),
    dnsControls.getByRole("button", { name: "Resume" }),
  );

  await page.setViewportSize({ height: 812, width: 375 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test("pane action rails align with filters and separate them", async ({ page }) => {
  await page.setViewportSize({ height: 720, width: 2048 });
  await enterAnonymousMode(page);

  const allLogsControls = page.getByRole("group", { name: "All logs status and actions" });
  await expect(allLogsControls).toHaveCSS("border-bottom-style", "solid");
  await expect(allLogsControls).toHaveCSS("border-bottom-width", "1px");
  await expectMatchingOuterEdges(
    allLogsControls.getByRole("status"),
    allLogsControls.getByRole("button", { name: "Clear", exact: true }),
    page.getByPlaceholder("Search logs"),
    page.getByRole("button", { name: "Reset", exact: true }),
  );

  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  const dnsControls = page.getByRole("group", {
    name: "DNS troubleshooting status and actions",
  });
  await expect(dnsControls).toHaveCSS("border-bottom-style", "solid");
  await expect(dnsControls).toHaveCSS("border-bottom-width", "1px");
  await expectMatchingOuterEdges(
    dnsControls.getByRole("status"),
    dnsControls.getByRole("button", { name: "Clear DNS results" }),
    page.getByRole("textbox", { name: "Domain or DNS search" }),
    page.getByRole("button", { name: "Reset", exact: true }),
  );
});

test("data source rail keeps source left and controls right", async ({ page }) => {
  await enterAnonymousMode(page);

  const rail = page.getByRole("region", { name: "Data source" });
  const dataSourceControls = rail.getByRole("group", { name: "Data source" });
  const viewControls = rail.getByRole("group", { name: "View" });
  const settingsButton = rail.getByRole("button", { name: "Settings", exact: true });
  await expectLeftInSameRow(dataSourceControls, viewControls);
  await expectLeftInSameRow(viewControls, settingsButton);
  await expectRightAligned(rail, settingsButton);
  await expect(viewControls.getByRole("button", { name: "All logs" })).toBeVisible();
  await expect(viewControls.getByRole("button", { name: "DNS troubleshooting" })).toBeVisible();
});

test("data source rail remains bounded at narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 });
  await enterAnonymousMode(page);

  const dataSource = page.getByRole("group", { name: "Data source" });
  await expect(dataSource.getByRole("button", { name: "Live Event Hub" })).toBeVisible();
  await expect(dataSource.getByRole("button", { name: "Log Analytics" })).toBeVisible();
  const view = page.getByRole("group", { name: "View" });
  const rail = page.getByRole("region", { name: "Data source" });
  const settingsButton = rail.getByRole("button", { name: "Settings", exact: true });
  await expect(view.getByRole("button", { name: "All logs" })).toBeVisible();
  await expect(view.getByRole("button", { name: "DNS troubleshooting" })).toBeVisible();
  await expectRightAligned(rail, settingsButton);
  const settingsDrawer = await openSettings(page);
  await expect(settingsDrawer.getByRole("button", { name: "Close settings" })).toBeVisible();
  await expect(async () => {
    const [drawerBox, workspaceBox] = await Promise.all([
      settingsDrawer.boundingBox(),
      settingsDrawer.locator("..").boundingBox(),
    ]);
    expect(drawerBox).not.toBeNull();
    expect(workspaceBox).not.toBeNull();
    expect(Math.abs(drawerBox!.x - workspaceBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(drawerBox!.width - workspaceBox!.width)).toBeLessThanOrEqual(1);
  }).toPass();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await expect(dataSource).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });
});

test("log detail renders destination flag and separates Event Hub metadata", async ({ page }) => {
  await page.route("**/api/ip-country", async (route) => {
    const body = route.request().postDataJSON() as { ips: string[] };
    await route.fulfill({
      contentType: "application/json",
      json: {
        results: body.ips.map((ip) => ({ countryCode: "US", ip })),
      },
    });
  });
  await enterAnonymousMode(page);
  await seedDetailLog(page);

  await page.getByRole("row").filter({ hasText: "deny-web" }).getByRole("cell").first().click();
  const dialog = page.getByRole("dialog", { name: "Log detail" });
  await expect(dialog.getByText("hub-policy", { exact: true })).toBeVisible();
  await expect(dialog.getByText("hub-collection-group", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Event Hub metadata" })).toBeVisible();
  await expect(dialog.getByText("Sequence", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Enqueued", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Partition", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Copy Policy" })).toBeVisible();
  await expect(
    dialog.getByRole("img", { name: "GeoIP country: United States (US)" }),
  ).toBeVisible();
});

test("log detail identifies an internal RFC 1918 destination", async ({ page }) => {
  await enterAnonymousMode(page);
  await seedDetailLog(page, "172.16.0.1");

  await page.getByRole("row").filter({ hasText: "deny-web" }).getByRole("cell").first().click();
  const dialog = page.getByRole("dialog", { name: "Log detail" });
  await expect(dialog.getByRole("img", { name: "Internal address (RFC 1918)" })).toBeVisible();
  await expect(dialog.getByText("172.16.0.1", { exact: true })).toBeVisible();
});

test("log detail explains a known ICMP type", async ({ page }) => {
  await enterAnonymousMode(page);
  await seedDetailLog(page, "20.30.40.50", "ICMP Type=8");

  await expect(
    page.getByRole("table", { name: "Firewall logs" }).getByText("ICMP Type=8", { exact: true }),
  ).toBeVisible();
  await page.getByRole("row").filter({ hasText: "deny-web" }).getByRole("cell").first().click();
  const dialog = page.getByRole("dialog", { name: "Log detail" });
  await expect(dialog.getByText("ICMP Type=8 (Echo Request)", { exact: true })).toBeVisible();
});

test("destination country flag follows a recycled visible row", async ({ page }) => {
  let releaseFirstLookup: (() => void) | undefined;
  const firstLookupStarted = new Promise<void>((resolve) => {
    releaseFirstLookup = resolve;
  });
  let firstRequestSeen: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => {
    firstRequestSeen = resolve;
  });

  await page.route("**/api/ip-country", async (route) => {
    const body = route.request().postDataJSON() as { ips: string[] };
    if (body.ips.includes("1.1.1.1")) {
      firstRequestSeen?.();
      await firstLookupStarted;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        results: body.ips.map((ip) => ({
          ip,
          countryCode: ip === "1.1.1.1" ? "AU" : "US",
        })),
      }),
    });
  });
  await enterAnonymousMode(page);
  await seedVisibleLog(page, "1.1.1.1");
  await firstRequest;
  await seedVisibleLog(page, "8.8.8.8");

  const destinationCell = page.getByRole("cell", { name: /8\.8\.8\.8/ });
  await expect(destinationCell.getByRole("img")).toHaveCount(0);
  releaseFirstLookup?.();
  await expect(
    destinationCell.getByRole("img", {
      name: "GeoIP country: United States (US)",
    }),
  ).toBeVisible();
  await expect(destinationCell).toContainText("🇺🇸");
});

test("local log retention is opt-in and clearing is persistent", async ({ page }) => {
  await enterAnonymousMode(page);
  await openSettings(page);

  const logRetentionSwitch = page.getByRole("switch", {
    name: "Local log retention",
  });
  await expect(logRetentionSwitch).not.toBeChecked();
  await appendLogHistory(page, [createPersistedLog("first-seed")]);
  await expect.poll(() => queryLogHistoryIds(page)).toEqual(["first-seed"]);
  await logRetentionSwitch.click();
  await expect(logRetentionSwitch).toBeChecked();
  await logRetentionSwitch.click();
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect.poll(() => queryLogHistoryIds(page)).toEqual([]);

  await logRetentionSwitch.click();
  await appendLogHistory(page, [createPersistedLog("second-seed")]);
  await expect.poll(() => queryLogHistoryIds(page)).toEqual(["second-seed"]);
  await page.reload();
  await expect(page).toHaveURL(/\/logs/);
  await openSettings(page);
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect.poll(() => queryLogHistoryIds(page)).toEqual([]);
  await expect(page.getByText("No logs received")).toBeVisible();
});

test("browser log history store queries, limits, deletes, and clears records", async ({ page }) => {
  await page.goto("/login");
  const now = Date.now();
  const oldest = createPersistedLog("oldest", new Date(now - 120_000).toISOString());
  const middle = createPersistedLog("middle", new Date(now - 60_000).toISOString());
  const newest = createPersistedLog("newest", new Date(now).toISOString());

  const result = await page.evaluate(
    async ({ moduleUrl, records }) => {
      const store = await import(moduleUrl);
      await store.clearLogHistory();
      await store.appendLogHistoryBatch(records, {
        maxAgeMs: 60 * 60 * 1_000,
        maxRecords: 2,
      });

      const afterCountPrune = await store.queryLogHistoryRange({ limit: 10 });
      const limitedRange = await store.queryLogHistoryRange({
        from: records[1]!.timestamp,
        limit: 1,
        to: records[2]!.timestamp,
      });
      const deletedCount = await store.deleteLogHistoryBefore(records[2]!.timestamp);
      const afterDelete = await store.queryLogHistoryRange({ limit: 10 });
      await store.clearLogHistory();
      const afterClear = await store.queryLogHistoryRange({ limit: 10 });

      return {
        afterClear: afterClear.map((record: PersistedFirewallLogRecord) => record.id),
        afterCountPrune: afterCountPrune.map((record: PersistedFirewallLogRecord) => record.id),
        afterDelete: afterDelete.map((record: PersistedFirewallLogRecord) => record.id),
        deletedCount,
        limitedRange: limitedRange.map((record: PersistedFirewallLogRecord) => record.id),
      };
    },
    {
      moduleUrl: LOG_HISTORY_STORE_MODULE_URL,
      records: [oldest, middle, newest],
    },
  );

  expect(result).toEqual({
    afterClear: [],
    afterCountPrune: ["newest", "middle"],
    afterDelete: ["newest"],
    deletedCount: 1,
    limitedRange: ["newest"],
  });
});

test("invalid Event Hub settings stay idle and show validation errors", async ({ page }) => {
  await enterAnonymousMode(page);
  await openSettings(page);

  await page
    .getByRole("textbox", { name: "Connection string*" })
    .fill("Endpoint=sb://example.servicebus.windows.net/;");
  await page.getByRole("textbox", { name: "Consumer group*" }).press("Enter");

  const notification = page.getByRole("listitem");
  await expect(notification).toContainText("Connection string must include SharedAccessKeyName.");
  await expect(notification).toContainText("Connection string must include SharedAccessKey.");
  await expect(notification).toContainText(
    "Event Hub name is required when EntityPath is not present.",
  );
  await expect(page.getByText("idle", { exact: true })).toBeVisible();
});

test("connection string persistence is explicit and reversible", async ({ page }) => {
  const connectionString =
    "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";

  await enterAnonymousMode(page);
  await openSettings(page);

  const connectionStringInput = page.getByRole("textbox", {
    name: "Connection string*",
  });
  const rememberConnectionString = page.getByRole("checkbox", {
    name: "Remember connection string",
  });

  await expect(connectionStringInput).toHaveValue("");
  await expect(rememberConnectionString).not.toBeChecked();
  await connectionStringInput.fill(connectionString);
  await rememberConnectionString.check();

  await page.reload();
  await expect(page).toHaveURL(/\/logs/);
  await openSettings(page);
  await expect(connectionStringInput).toHaveValue(connectionString);
  await expect(rememberConnectionString).toBeChecked();

  await rememberConnectionString.uncheck();
  await page.reload();
  await expect(page).toHaveURL(/\/logs/);
  await openSettings(page);
  await expect(connectionStringInput).toHaveValue("");
  await expect(rememberConnectionString).not.toBeChecked();
});

test("connection string remains opted in when browser storage removal fails", async ({ page }) => {
  const connectionString =
    "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";

  await enterAnonymousMode(page);
  await openSettings(page);

  const connectionStringInput = page.getByRole("textbox", {
    name: "Connection string*",
  });
  const rememberConnectionString = page.getByRole("checkbox", {
    name: "Remember connection string",
  });
  await connectionStringInput.fill(connectionString);
  await rememberConnectionString.check();
  await page.evaluate((key) => {
    const removeItem = Storage.prototype.removeItem;
    Storage.prototype.removeItem = function (itemKey) {
      if (itemKey === key) {
        throw new DOMException("Storage is blocked", "SecurityError");
      }
      return removeItem.call(this, itemKey);
    };
  }, EVENT_HUB_CONNECTION_STRING_STORAGE_KEY);

  await rememberConnectionString.click();

  await expect(rememberConnectionString).toBeChecked();
  await expect(
    page.getByText("Connection string could not be removed from browser storage."),
  ).toBeVisible();
});

test("connection string stays opted out when browser storage saving fails", async ({ page }) => {
  const connectionString =
    "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";
  await enterAnonymousMode(page);
  await openSettings(page);

  const connectionStringInput = page.getByRole("textbox", {
    name: "Connection string*",
  });
  const rememberConnectionString = page.getByRole("checkbox", {
    name: "Remember connection string",
  });
  await connectionStringInput.fill(connectionString);
  await page.evaluate((key) => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (itemKey, value) {
      if (itemKey === key) {
        throw new DOMException("Storage is blocked", "SecurityError");
      }
      return setItem.call(this, itemKey, value);
    };
  }, EVENT_HUB_CONNECTION_STRING_STORAGE_KEY);

  await rememberConnectionString.click();

  await expect(rememberConnectionString).not.toBeChecked();
  await expect(
    page.getByText("Connection string could not be saved in browser storage."),
  ).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/\/logs/);
  await openSettings(page);
  await expect(connectionStringInput).toHaveValue("");
  await expect(rememberConnectionString).not.toBeChecked();
});

test("anonymous request cannot query Log Analytics", async ({ request }) => {
  const response = await request.post("/api/log-analytics/query", {
    data: {
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
    },
  });

  expect(response.status()).toBe(401);
});
