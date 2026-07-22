import { expect, type Locator, test } from "@playwright/test";

import { mockManagedDeployment } from "./support/deployment";
import { openSettings } from "./support/logsWorkspace";

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
  await expect.poll(() => readinessRequests, { timeout: 15_000 }).toBe(1);
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
