import { expect, type Locator, type Page, test } from "@playwright/test";

import type { ManagedEventHubStreamEnvelope } from "../../shared/types/managedEventHub";
import { mockManagedDeployment } from "./support/deployment";
import { enterAnonymousMode, openSettings } from "./support/logsWorkspace";
import {
  enqueueManagedEventHubEnvelope,
  mockManagedEventHubStream,
} from "./support/managedEventHub";

const MERIDIEM_PATTERN = /AM|PM/;

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

test("time format setting controls rendered log and DNS timestamps", async ({ page }) => {
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
  await expect(noonRow.locator("time")).toHaveText("Jul 21, 2026, 12:09:24");
  await expect(midnightRow.locator("time")).toHaveText("Jul 21, 2026, 00:09:24");

  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  const dnsEntry = page.getByRole("button", { name: "Open DNS details for midnight.example." });
  await expect(dnsEntry.locator("time")).not.toContainText(MERIDIEM_PATTERN);
  await page.getByRole("button", { name: "All logs" }).click();

  const settingsDrawer = await openSettings(page);
  const timeFormatSwitch = page.getByRole("switch", { name: "12-hour time" });
  await expect(timeFormatSwitch).not.toBeChecked();
  await timeFormatSwitch.click();
  await expect(timeFormatSwitch).toBeChecked();
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();

  await expect(noonRow.locator("time")).toHaveText("Jul 21, 2026, 12:09:24 PM");
  await expect(midnightRow.locator("time")).toHaveText("Jul 21, 2026, 12:09:24 AM");
  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  await expect(dnsEntry.locator("time")).toContainText(MERIDIEM_PATTERN);
  await dnsEntry.click();
  await expect(
    page.getByRole("dialog", { name: "DNS resolution detail" }).locator("time").first(),
  ).toContainText(MERIDIEM_PATTERN);

  await page.reload();
  const reloadedSettings = await openSettings(page);
  await expect(timeFormatSwitch).toBeChecked();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await reloadedSettings.getByRole("button", { name: "Close settings" }).click();
  await enqueueManagedEventHubEnvelope(page, timeFormatEvents);
  await expect(
    page
      .getByRole("table", { name: "Firewall logs" })
      .getByRole("row")
      .filter({ hasText: "20.30.40.50" })
      .locator("time"),
  ).toHaveText("Jul 21, 2026, 12:09:24 PM");
});
