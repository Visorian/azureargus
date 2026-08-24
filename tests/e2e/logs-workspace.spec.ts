import { expect, type Locator, type Page, test } from "@playwright/test";

import type { ManagedEventHubStreamEnvelope } from "../../shared/types/managedEventHub";
import { mockManagedDeployment } from "./support/deployment";
import { enterAnonymousMode, openSettings } from "./support/logsWorkspace";
import {
  enqueueManagedEventHubEnvelope,
  mockManagedEventHubStream,
} from "./support/managedEventHub";

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

async function connectManagedEventHub(page: Page) {
  const settingsDrawer = await openSettings(page);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
}

async function startManagedEventHub(page: Page) {
  await mockManagedDeployment(page, { eventHub: true, logAnalytics: false });
  await mockManagedEventHubStream(page);
  await page.goto("/logs");
  await connectManagedEventHub(page);
}

async function enqueueDetailLog(page: Page, destinationIp = "20.30.40.50", protocol = "TCP") {
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          category: "AZFWNetworkRule",
          properties: {
            Action: "Deny",
            DestinationIp: destinationIp,
            DestinationPort: 443,
            msg: "detail-record",
            Policy: "hub-policy",
            Protocol: protocol,
            Rule: "deny-web",
            RuleCollection: "blocked",
            RuleCollectionGroup: "hub-collection-group",
            SourceIp: "10.140.16.133",
            SourcePort: 15213,
          },
          time: "2026-07-12T16:36:42.015Z",
        },
        enqueuedTimeUtc: "2026-07-12T16:37:56.822Z",
        partitionId: "0",
        sequenceNumber: 5_234_806,
      },
    ],
  });
  await expect(page.getByText("1 visible / 1 received")).toBeVisible();
}

test("receiver status indicators follow the active pane actions", async ({ page }) => {
  await startManagedEventHub(page);
  await enqueueDetailLog(page);

  const dataSource = page.getByRole("region", { name: "Data source" });
  await expect(dataSource.getByRole("status")).toHaveCount(0);
  await expect(dataSource.getByText("Catching up", { exact: true })).toHaveCount(0);

  const allLogsControls = page.getByRole("group", { name: "All logs status and actions" });
  await expect(allLogsControls.getByRole("status")).toHaveText("connected");
  await allLogsControls.getByRole("button", { name: "Pause" }).click();
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

test("main log table scrolls horizontally at a narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 700, width: 900 });
  await startManagedEventHub(page);
  await enqueueDetailLog(page);

  const table = page.getByTestId("log-table-scroll");
  await expect(table).toHaveCSS("overflow-x", "auto");
  await expect
    .poll(() => table.evaluate((element) => element.scrollWidth > element.clientWidth))
    .toBe(true);

  await table.evaluate((element) => {
    element.scrollLeft = element.scrollWidth - element.clientWidth;
  });
  await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);

  const ruleHeader = table.getByRole("columnheader", { name: "Rule" });
  const ruleCell = table.getByRole("row").filter({ hasText: "deny-web" }).getByRole("cell").nth(8);
  await expect(ruleHeader).toBeInViewport();
  await expect(ruleCell).toBeInViewport();
  await expect(async () => {
    const [headerBox, cellBox] = await Promise.all([
      ruleHeader.boundingBox(),
      ruleCell.boundingBox(),
    ]);
    expect(headerBox).not.toBeNull();
    expect(cellBox).not.toBeNull();
    expect(Math.abs(headerBox!.x - cellBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(headerBox!.width - cellBox!.width)).toBeLessThanOrEqual(1);
  }).toPass();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
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
  await startManagedEventHub(page);
  await enqueueDetailLog(page);

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
  await startManagedEventHub(page);
  await enqueueDetailLog(page, "172.16.0.1");

  await page.getByRole("row").filter({ hasText: "deny-web" }).getByRole("cell").first().click();
  const dialog = page.getByRole("dialog", { name: "Log detail" });
  await expect(dialog.getByRole("img", { name: "Internal address (RFC 1918)" })).toBeVisible();
  await expect(dialog.getByText("172.16.0.1", { exact: true })).toBeVisible();
});

test("log detail explains a known ICMP type", async ({ page }) => {
  await startManagedEventHub(page);
  await enqueueDetailLog(page, "20.30.40.50", "ICMP Type=8");

  await expect(
    page.getByRole("table", { name: "Firewall logs" }).getByText("ICMP Type=8", { exact: true }),
  ).toBeVisible();
  await page.getByRole("row").filter({ hasText: "deny-web" }).getByRole("cell").first().click();
  const dialog = page.getByRole("dialog", { name: "Log detail" });
  await expect(dialog.getByText("ICMP Type=8 (Echo Request)", { exact: true })).toBeVisible();
});

test("orders realtime logs by source timestamp", async ({ page }) => {
  await startManagedEventHub(page);
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          category: "AZFWNetworkRule",
          properties: { Action: "Allow", Protocol: "UDP", Rule: "newest" },
          time: "2026-08-13T13:06:47.932Z",
        },
        enqueuedTimeUtc: "2026-08-13T13:07:00.000Z",
        partitionId: "0",
        sequenceNumber: 1,
      },
      {
        body: {
          category: "AZFWDnsQuery",
          properties: { Action: "DNS query", Protocol: "UDP", Rule: "oldest" },
          time: "2026-08-13T11:55:11.945Z",
        },
        enqueuedTimeUtc: "2026-08-13T13:07:00.001Z",
        partitionId: "0",
        sequenceNumber: 2,
      },
      {
        body: {
          category: "AzureFirewallApplicationRule",
          properties: { Action: "Allow", Protocol: "HTTPS", Rule: "middle" },
          time: "2026-08-13T13:05:07.659Z",
        },
        enqueuedTimeUtc: "2026-08-13T13:07:00.002Z",
        partitionId: "0",
        sequenceNumber: 3,
      },
    ],
  });

  await expect(page.getByText("3 visible / 3 received")).toBeVisible();
  const rows = page.getByRole("table", { name: "Firewall logs" }).getByRole("row");
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText("newest");
  await expect(rows.nth(2)).toContainText("middle");
  await expect(rows.nth(3)).toContainText("oldest");
});

test("filters source and destination endpoints exactly", async ({ page }) => {
  await startManagedEventHub(page);
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          category: "AZFWApplicationRule",
          properties: {
            Action: "Allow",
            DestinationIp: "20.30.40.5",
            DestinationPort: 443,
            Protocol: "HTTPS",
            Rule: "exact-endpoints",
            SourceIp: "10.141.8.1",
            SourcePort: 52_385,
          },
          time: "2026-08-13T13:57:01.000Z",
        },
        enqueuedTimeUtc: "2026-08-13T13:58:00.000Z",
        partitionId: "0",
        sequenceNumber: 1,
      },
      {
        body: {
          category: "AZFWApplicationRule",
          properties: {
            Action: "Allow",
            DestinationIp: "20.30.40.50",
            DestinationPort: 443,
            Protocol: "HTTPS",
            Rule: "prefix-endpoints",
            SourceIp: "10.141.8.11",
            SourcePort: 52_389,
          },
          time: "2026-08-13T13:57:02.000Z",
        },
        enqueuedTimeUtc: "2026-08-13T13:58:00.001Z",
        partitionId: "0",
        sequenceNumber: 2,
      },
    ],
  });

  await expect(page.getByText("2 visible / 2 received")).toBeVisible();
  const table = page.getByRole("table", { name: "Firewall logs" });

  await page.getByPlaceholder("Source").fill("10.141.8.1");
  await expect(table.getByRole("row").filter({ hasText: "exact-endpoints" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "prefix-endpoints" })).toHaveCount(0);

  await page.getByPlaceholder("Source").fill("");
  await page.getByPlaceholder("Destination").fill("20.30.40.5");
  await expect(table.getByRole("row").filter({ hasText: "exact-endpoints" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "prefix-endpoints" })).toHaveCount(0);
});

test("keeps surfaced logs eligible when filters change after raw-buffer eviction", async ({
  page,
}) => {
  await mockManagedDeployment(page, { eventHub: true, logAnalytics: false });
  await mockManagedEventHubStream(page);
  await page.goto("/logs");
  const settingsDrawer = await openSettings(page);
  await settingsDrawer.getByRole("spinbutton", { name: "Visible rows" }).fill("100");
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();

  const destinationIp = "131.189.255.123";
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          category: "AZFWNatRule",
          properties: { DestinationIp: destinationIp, Rule: "nat-new" },
          time: "2026-08-24T11:52:16.000Z",
        },
        enqueuedTimeUtc: "2026-08-24T11:52:17.000Z",
        partitionId: "0",
        sequenceNumber: 1,
      },
      {
        body: {
          category: "AZFWNetworkRule",
          properties: { DestinationIp: destinationIp, Rule: "network-new" },
          time: "2026-08-24T11:52:16.000Z",
        },
        enqueuedTimeUtc: "2026-08-24T11:52:17.001Z",
        partitionId: "0",
        sequenceNumber: 2,
      },
      {
        body: {
          category: "AZFWNatRule",
          properties: { DestinationIp: destinationIp, Rule: "nat-old" },
          time: "2026-08-24T11:51:41.000Z",
        },
        enqueuedTimeUtc: "2026-08-24T11:52:17.002Z",
        partitionId: "0",
        sequenceNumber: 3,
      },
      {
        body: {
          category: "AZFWNetworkRule",
          properties: { DestinationIp: destinationIp, Rule: "network-old" },
          time: "2026-08-24T11:51:41.000Z",
        },
        enqueuedTimeUtc: "2026-08-24T11:52:17.003Z",
        partitionId: "0",
        sequenceNumber: 4,
      },
    ],
  });
  await expect(page.getByText("4 visible / 4 received")).toBeVisible();

  const search = page.getByPlaceholder("Search logs");
  await search.fill(destinationIp);
  await expect(page.getByText("4 visible / 4 received")).toBeVisible();

  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: Array.from({ length: 1_001 }, (_, index) => ({
      body: {
        category: "AZFWApplicationRule",
        properties: {
          DestinationIp: "192.0.2.10",
          Rule: `filler-${index}`,
        },
        time: "2026-08-24T11:58:00.000Z",
      },
      enqueuedTimeUtc: "2026-08-24T11:58:01.000Z",
      partitionId: "0",
      sequenceNumber: index + 5,
    })),
  });
  await expect(page.getByText("4 visible / 1005 received")).toBeVisible();

  await search.fill("");
  await expect(page.getByText("100 visible / 1005 received")).toBeVisible();
  await page.getByRole("button", { name: "Category filter" }).click();
  await page.getByRole("option", { name: "AZFWNatRule", exact: true }).click();
  await page.keyboard.press("Escape");

  await expect(page.getByText("2 visible / 1005 received")).toBeVisible();
  const table = page.getByRole("table", { name: "Firewall logs" });
  await expect(table.getByRole("row").filter({ hasText: "nat-new" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: "nat-old" })).toBeVisible();
});

test("renders application-rule FQDN destinations and full category names", async ({ page }) => {
  await startManagedEventHub(page);
  const structuredFqdn = "germanywestcentral-gas.guestconfiguration.azure.com";
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          time: "2026-08-13T13:57:01.735317+00:00",
          operationName: "AzureFirewallApplicationRuleLog",
          properties: {
            msg: "HTTPS request from 10.141.8.11:52386 to login.live.com:443. Action: Allow. Policy: obh-afwp-glob-001. Rule Collection Group: obh-rcg-glob-Internet-001. Rule Collection: Allow_Outbound_Internet_SNAT. Rule: Internet-Access",
          },
          category: "AzureFirewallApplicationRule",
        },
        enqueuedTimeUtc: "2026-08-13T14:09:00.000Z",
        partitionId: "0",
        sequenceNumber: 1,
      },
      {
        body: {
          time: "2026-08-13T14:08:50.152602+00:00",
          properties: {
            Protocol: "HTTPS",
            SourceIp: "10.140.17.5",
            SourcePort: 41_936,
            DestinationPort: 443,
            Fqdn: structuredFqdn,
            Action: "Allow",
            Rule: "Internet-Access",
          },
          category: "AZFWApplicationRule",
        },
        enqueuedTimeUtc: "2026-08-13T14:09:00.001Z",
        partitionId: "0",
        sequenceNumber: 2,
      },
    ],
  });

  await expect(page.getByText("2 visible / 2 received")).toBeVisible();
  const table = page.getByRole("table", { name: "Firewall logs" });
  const legacyRow = table.getByRole("row").filter({ hasText: "login.live.com" });
  const structuredRow = table.getByRole("row").filter({ hasText: structuredFqdn });
  await expect(legacyRow).toContainText("443");
  await expect(structuredRow).toContainText("443");
  await expect(structuredRow).not.toHaveAttribute("title");
  await expect(structuredRow.getByRole("cell").nth(1)).toHaveAttribute(
    "title",
    "AZFWApplicationRule",
  );
  await expect(structuredRow.getByRole("cell").nth(6)).toHaveAttribute("title", structuredFqdn);
  await expect(structuredRow.getByRole("cell").nth(8)).toHaveAttribute("title", "Internet-Access");

  await page.getByRole("button", { name: "Category filter" }).click();
  for (const category of ["AZFWApplicationRule", "AzureFirewallApplicationRule"]) {
    const label = page.getByRole("option", { name: category, exact: true }).getByText(category, {
      exact: true,
    });
    await expect(label).toBeVisible();
    await expect
      .poll(() => label.evaluate((element) => element.scrollWidth <= element.clientWidth))
      .toBe(true);
  }
});

test.describe("time display preferences", () => {
  test.use({ timezoneId: "America/Los_Angeles" });

  test("controls and persists rendered log and DNS timestamps", async ({ page }) => {
    await startManagedEventHub(page);
    const timeFormatEvents: ManagedEventHubStreamEnvelope = {
      type: "events",
      events: [
        {
          body: {
            category: "AZFWNetworkRule",
            properties: {
              Action: "Allow",
              DestinationIp: "20.30.40.50",
              DestinationPort: 443,
              msg: "noon-format-record",
              Protocol: "TCP",
              SourceIp: "10.140.16.133",
              SourcePort: 15_213,
            },
            time: "2026-07-21T12:09:24.536Z",
          },
          enqueuedTimeUtc: "2026-07-21T12:09:25.000Z",
          partitionId: "0",
          sequenceNumber: 1,
        },
        {
          body: {
            category: "AzureFirewallDnsProxy",
            operationName: "AzureFirewallDnsProxyLog",
            properties: {
              msg: "DNS Request: 10.140.16.133:29135 - 50772 A IN midnight.example. udp 57 false 1232 NOERROR qr,rd,ra 336 0.0032s",
            },
            time: "2026-07-21T00:09:24.536Z",
          },
          enqueuedTimeUtc: "2026-07-21T00:09:25.000Z",
          partitionId: "0",
          sequenceNumber: 2,
        },
      ],
    };

    await enqueueManagedEventHubEnvelope(page, timeFormatEvents);
    await expect(page.getByText("2 visible / 2 received")).toBeVisible();

    const logsTable = page.getByRole("table", { name: "Firewall logs" });
    const noonRow = logsTable.getByRole("row").filter({ hasText: "20.30.40.50" });
    const midnightRow = logsTable.getByRole("row").filter({ hasText: "AzureFirewallDnsProxy" });
    await expect(logsTable.getByRole("columnheader", { name: "Date (UTC)" })).toBeVisible();
    await expect(noonRow.locator("time")).toHaveText("Jul 21, 2026, 12:09:24");
    await expect(midnightRow.locator("time")).toHaveText("Jul 21, 2026, 00:09:24");

    await page.getByRole("button", { name: "DNS troubleshooting" }).click();
    const dnsEntry = page.getByRole("button", { name: "Open DNS details for midnight.example." });
    await expect(page.getByTestId("dns-entry-header").getByText("Time (UTC)")).toBeVisible();
    await expect(dnsEntry.locator("time")).toHaveText("00:09:24");
    await page.getByRole("button", { name: "All logs" }).click();

    const settingsDrawer = await openSettings(page);
    const timeFormatSwitch = page.getByRole("switch", { name: "12-hour time" });
    const localTimeSwitch = page.getByRole("switch", { name: "Local time" });
    await expect(timeFormatSwitch).not.toBeChecked();
    await expect(localTimeSwitch).not.toBeChecked();
    await expectLeftInSameRow(timeFormatSwitch, localTimeSwitch);
    await localTimeSwitch.click();
    await expect(localTimeSwitch).toBeChecked();
    await expect(timeFormatSwitch).not.toBeChecked();
    await settingsDrawer.getByRole("button", { name: "Close settings" }).click();

    await expect(
      logsTable.getByRole("columnheader", { name: "Date (America/Los_Angeles)" }),
    ).toBeVisible();
    await expect(noonRow.locator("time")).toHaveText("Jul 21, 2026, 05:09:24");
    await expect(midnightRow.locator("time")).toHaveText("Jul 20, 2026, 17:09:24");
    await page.getByRole("button", { name: "DNS troubleshooting" }).click();
    await expect(
      page.getByTestId("dns-entry-header").getByText("Time (America/Los_Angeles)"),
    ).toBeVisible();
    await expect(dnsEntry.locator("time")).toHaveText("17:09:24");

    const localSettings = await openSettings(page);
    await timeFormatSwitch.click();
    await expect(timeFormatSwitch).toBeChecked();
    await expect(localTimeSwitch).toBeChecked();
    await localSettings.getByRole("button", { name: "Close settings" }).click();

    await expect(dnsEntry.locator("time")).toHaveText("05:09:24 PM");
    await dnsEntry.click();
    const dnsDialog = page.getByRole("dialog", { name: "DNS resolution detail" });
    await expect(dnsDialog.getByText("Times shown in America/Los_Angeles")).toBeVisible();
    await expect(dnsDialog.locator("time").first()).toHaveText("Jul 20, 2026, 5:09:24 PM");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "All logs" }).click();

    await expect(noonRow.locator("time")).toHaveText("Jul 21, 2026, 05:09:24 AM");
    await expect(noonRow.getByRole("cell").first()).toHaveAttribute(
      "title",
      "Jul 21, 2026, 05:09:24.536 AM",
    );
    await noonRow.getByRole("cell").first().click();
    const logDialog = page.getByRole("dialog", { name: "Log detail" });
    await expect(logDialog.getByText("Times shown in America/Los_Angeles")).toBeVisible();
    await expect(
      logDialog.getByText("Jul 21, 2026, 05:09:24.536 AM", { exact: true }),
    ).toBeVisible();
    await expect(logDialog.getByText("Jul 21, 2026, 05:09:25 AM", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    const utcSettings = await openSettings(page);
    await localTimeSwitch.click();
    await expect(localTimeSwitch).not.toBeChecked();
    await expect(timeFormatSwitch).toBeChecked();
    await utcSettings.getByRole("button", { name: "Close settings" }).click();
    await expect(logsTable.getByRole("columnheader", { name: "Date (UTC)" })).toBeVisible();
    await expect(noonRow.locator("time")).toHaveText("Jul 21, 2026, 12:09:24 PM");
    await expect(midnightRow.locator("time")).toHaveText("Jul 21, 2026, 12:09:24 AM");

    const persistedSettings = await openSettings(page);
    await localTimeSwitch.click();
    await persistedSettings.getByRole("button", { name: "Close settings" }).click();

    await page.reload();
    const reloadedSettings = await openSettings(page);
    await expect(timeFormatSwitch).toBeChecked();
    await expect(localTimeSwitch).toBeChecked();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await reloadedSettings.getByRole("button", { name: "Close settings" }).click();
    await enqueueManagedEventHubEnvelope(page, timeFormatEvents);
    const reloadedTable = page.getByRole("table", { name: "Firewall logs" });
    await expect(
      reloadedTable.getByRole("columnheader", { name: "Date (America/Los_Angeles)" }),
    ).toBeVisible();
    await expect(
      reloadedTable.getByRole("row").filter({ hasText: "20.30.40.50" }).locator("time"),
    ).toHaveText("Jul 21, 2026, 05:09:24 AM");
  });

  test("labels applied Log Analytics ranges in the selected time zone", async ({ page }) => {
    await mockManagedDeployment(page, { eventHub: false, logAnalytics: true });
    await page.route("**/api/log-analytics/dns/readiness", async (route) => {
      await route.fulfill({ contentType: "application/json", json: { readiness: [] } });
    });
    await page.route("**/api/log-analytics/query", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        from: "2026-07-21T19:00:00.000Z",
        to: "2026-07-21T20:00:00.000Z",
      });
      await route.fulfill({
        contentType: "application/json",
        json: { limit: 1_000, records: [], truncated: false },
      });
    });

    await page.goto("/logs");
    await page.getByRole("textbox", { name: "Start" }).fill("2026-07-21T12:00");
    await page.getByRole("textbox", { name: "End" }).fill("2026-07-21T13:00");
    await page.getByRole("button", { name: "Run query" }).click();
    await expect(page.getByText("0 visible", { exact: true })).toBeVisible();

    await page.getByRole("textbox", { name: "Start" }).fill("2026-07-21T12:30");
    const appliedRange = page.locator("p").filter({ hasText: "Run query to apply date range." });
    await expect(appliedRange).toContainText(
      "Jul 21, 2026, 19:00:00 to Jul 21, 2026, 20:00:00 (UTC)",
    );

    const settingsDrawer = await openSettings(page);
    await settingsDrawer.getByRole("switch", { name: "Local time" }).click();
    await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
    await expect(appliedRange).toContainText(
      "Jul 21, 2026, 12:00:00 to Jul 21, 2026, 13:00:00 (America/Los_Angeles)",
    );
  });
});
