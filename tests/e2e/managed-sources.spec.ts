import { expect, test } from "@playwright/test";

import { mockManagedDeployment } from "./support/deployment";
import { openSettings } from "./support/logsWorkspace";
import {
  enqueueManagedEventHubEnvelope,
  getManagedEventHubRequests,
  mockManagedEventHubStream,
} from "./support/managedEventHub";

test("managed Event Hub uses configured server stream without exposing credentials", async ({
  page,
}) => {
  await mockManagedDeployment(page, { eventHub: true, logAnalytics: true });
  await mockManagedEventHubStream(page);

  await page.goto("/logs");
  await expect(page.getByText("Managed User")).toBeVisible({ timeout: 15_000 });
  const settingsDrawer = await openSettings(page);
  await expect(page.getByRole("textbox", { name: "Connection string" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Event Hub name" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Remember connection string" })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect
    .poll(() => getManagedEventHubRequests(page))
    .toEqual([{ consumerGroup: "$Default", lookbackMinutes: 15 }]);
  await expect
    .poll(async () => JSON.stringify(await getManagedEventHubRequests(page)))
    .not.toContain("connectionString");
  await enqueueManagedEventHubEnvelope(page, {
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
  });
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByText("2 visible / 2 received")).toBeVisible();
  await expect(page.getByText("Catching up", { exact: true })).toBeVisible();
  await enqueueManagedEventHubEnvelope(page, { type: "caught-up" });
  await expect(page.getByText("Latest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Event Hub settings" })).toHaveCount(0);
  await expect(
    page.getByRole("row", { name: /Jul 12, 2026.*AZFWNetworkRule.*Allow.*TCP/ }),
  ).toBeVisible();
  const categoryFilter = page.getByRole("button", { name: "Category filter" });
  await categoryFilter.click();
  const networkCategory = page.getByRole("option", { name: "AZFWNetworkRule", exact: true });
  const dnsCategory = page.getByRole("option", { name: "AzureFirewallDnsProxy", exact: true });
  await networkCategory.click();
  await expect(page.getByText("1 visible / 2 received")).toBeVisible();
  await dnsCategory.click();
  await expect(page.getByText("2 visible / 2 received")).toBeVisible();
  await networkCategory.click();
  await expect(page.getByText("1 visible / 2 received")).toBeVisible();
  await page.keyboard.press("Escape");
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
  await page.getByRole("button", { name: "All logs" }).click();
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(page.getByText("0 visible / 0 received")).toBeVisible();
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          records: [
            {
              Action: "Allow",
              Category: "AZFWNetworkRule",
              msg: "post-clear-record",
              Protocol: "TCP",
              TimeGenerated: "2026-07-12T14:31:00.000Z",
            },
          ],
        },
        enqueuedTimeUtc: "2026-07-12T14:31:01.000Z",
        partitionId: "0",
        sequenceNumber: 43,
      },
    ],
  });
  await expect(page.getByText("Latest", { exact: true })).toBeVisible();
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
    expect(requestBody.filters.category).toEqual(["AZFWNetworkRule", "AZFWApplicationRule"]);
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
  await page.getByRole("button", { name: "Category filter" }).click();
  await page.getByRole("option", { name: "AZFWNetworkRule", exact: true }).click();
  await page.getByRole("option", { name: "AZFWApplicationRule", exact: true }).click();
  await page.keyboard.press("Escape");
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
