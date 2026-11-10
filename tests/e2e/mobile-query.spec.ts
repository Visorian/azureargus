import { expect, test } from "@playwright/test";

import type { DnsEntry } from "../../shared/types/dns";
import type { LogAnalyticsQueryResponse } from "../../shared/types/logAnalytics";
import { mockManagedDeployment } from "./support/deployment";

test.use({ timezoneId: "Europe/Berlin" });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true });
  await page.route("**/api/log-analytics/dns/readiness", async (route) => {
    await route.fulfill({ json: { readiness: [] } });
  });
});

test("mobile query keeps keyboard focus while loading and retains feedback after failure", async ({
  page,
}) => {
  let requests = 0;
  let releaseQuery!: () => void;
  const pendingQuery = new Promise<void>((resolve) => {
    releaseQuery = resolve;
  });
  const result: LogAnalyticsQueryResponse = {
    limit: 1_000,
    truncated: false,
    records: [
      {
        id: "query-result",
        timestamp: "2026-07-21T15:30:00.000Z",
        category: "AZFWNetworkRule",
        action: "Allow",
        protocol: "TCP",
        sourceIp: "10.0.0.4",
        destinationIp: "10.0.0.5",
        message: "Allowed internal traffic",
        raw: {},
        searchableText: "allow tcp internal traffic",
      },
    ],
  };
  await page.route("**/api/log-analytics/query", async (route) => {
    requests += 1;
    if (requests === 1) {
      expect(route.request().postDataJSON()).toMatchObject({
        from: "2026-07-21T13:00:00.000Z",
        to: "2026-07-21T14:00:00.000Z",
      });
      await pendingQuery;
      await route.fulfill({ json: result });
    } else {
      expect(route.request().postDataJSON()).toMatchObject({ to: "2026-07-21T15:00:00.000Z" });
      await route.fulfill({ status: 502, json: { message: "Workspace is unavailable." } });
    }
  });

  try {
    await page.goto("/logs");
    await page.getByRole("button", { name: "Choose time range" }).click();
    const sheet = page.getByRole("dialog", { name: "Query & filters" });
    const start = sheet.getByRole("textbox", { name: "Start" });
    await expect(start).toBeFocused();
    await start.fill("2026-07-21T15:00");
    await sheet.getByRole("textbox", { name: "End" }).fill("2026-07-21T16:00");
    await expect(sheet.getByTestId("converted-query-range")).toContainText("13:00");
    await expect(sheet.getByTestId("converted-query-range")).toContainText("14:00");
    await expect(sheet.getByTestId("converted-query-range")).toContainText("UTC");
    const run = sheet.getByRole("button", { name: "Run query", exact: true });
    await run.focus();
    await page.keyboard.press("Enter");
    const loading = sheet.getByRole("button", { name: "Running query" });
    await expect(loading).toHaveAttribute("aria-busy", "true");
    await expect(loading).toBeFocused();
    expect(
      await loading.evaluate((button) => button instanceof HTMLButtonElement && button.disabled),
    ).toBe(false);
    await page.keyboard.press("Enter");
    expect(requests).toBe(1);
    await page.keyboard.press("Tab");
    expect(await sheet.evaluate((dialog) => dialog.contains(document.activeElement))).toBe(true);
    releaseQuery();
    await sheet.getByRole("button", { name: "Show 1 result", exact: true }).click();
    await expect(page.getByRole("button", { name: "Query & filters", exact: true })).toBeFocused();
    const appliedRange = page.getByTestId("mobile-applied-range");
    await expect(appliedRange).toContainText("2026");
    await expect(appliedRange).toContainText("UTC");
    const previousRange = await appliedRange.textContent();

    await page.getByRole("button", { name: "Query & filters", exact: true }).click();
    await sheet.getByRole("textbox", { name: "End" }).fill("2026-07-21T17:00");
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText("Changes not applied.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Review query" }).click();
    await expect(sheet.getByRole("button", { name: "Close", exact: true })).toBeFocused();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByRole("textbox", { name: "Search logs" }).press("Enter");
    await expect(page.getByText("Last query failed. Showing previous results.")).toBeVisible();
    await page.getByRole("button", { name: "Review query" }).click();
    await expect(sheet.getByRole("alert")).toContainText("Workspace is unavailable.");
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText("Last query failed. Showing previous results.")).toBeVisible();
    await expect(page.getByText("Query failed", { exact: true })).toBeVisible();
    await expect(appliedRange).toHaveText(previousRange ?? "");
    await expect(page.getByRole("button", { name: "Open log details", exact: false })).toHaveCount(
      1,
    );
    await page.getByRole("textbox", { name: "Search logs" }).fill("nomatch");
    await expect(page.getByRole("button", { name: "Reset filters", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Change time range" })).toHaveCount(0);
    await expect(page.getByText("Last query failed.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open log details", exact: false })).toHaveCount(
      1,
    );
  } finally {
    releaseQuery();
  }
});

test("mobile empty query explains filters and hides range actions until refresh finishes", async ({
  page,
}) => {
  let requests = 0;
  let releaseRefresh!: () => void;
  const pendingRefresh = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route("**/api/log-analytics/query", async (route) => {
    requests += 1;
    if (requests === 3) {
      await pendingRefresh;
    }
    await route.fulfill({ json: { limit: 1_000, records: [], truncated: false } });
  });
  try {
    await page.goto("/logs");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Choose time range" }).click();
    const sheet = page.getByRole("dialog", { name: "Query & filters" });
    await sheet.getByRole("textbox", { name: "Start" }).fill("2026-07-21T15:00");
    await sheet.getByRole("textbox", { name: "End" }).fill("2026-07-21T16:00");
    await sheet.getByRole("button", { name: "Run query", exact: true }).click();
    await sheet.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("textbox", { name: "Search logs" }).fill("nomatch-zzz");
    await expect.poll(() => requests).toBe(2);
    await expect(
      page.getByText("No logs match the applied filters in this time range."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Reset filters", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Reset filters", exact: true }).click();
    await expect.poll(() => requests).toBe(3);
    await expect(
      page.getByRole("heading", { name: "Updating results", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Change time range" })).toHaveCount(0);
    releaseRefresh();
    await expect(
      page.getByRole("heading", { name: "No logs in range", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Change time range" })).toBeVisible();
  } finally {
    releaseRefresh();
  }
});

test("mobile DNS reapplies edited filters and offers a time range action after empty results", async ({
  page,
}) => {
  const requests: unknown[] = [];
  const entries: DnsEntry[] = [
    "login.example.com.",
    "example.com.",
    "api.example.com.",
    "blob.example.com.",
    "status.example.com.",
  ].map((queryName, index) => ({
    id: `dns-${index}`,
    timestamp: "2026-07-21T13:30:00.000Z",
    queryName,
    queryType: "A",
    client: "10.0.0.4",
    protocol: "UDP",
    path: "proxy",
    outcome: "response-unknown",
    observationCount: 1,
    completeness: "complete",
    confidence: "uncorrelated",
    source: "proxy-structured",
    warnings: [],
    observations: [],
  }));
  await page.route("**/api/log-analytics/dns/list", async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        queriedEntries: requests.length === 1 ? [] : entries,
        transportObservations: [],
        queriedEntriesTruncated: false,
        transportObservationsTruncated: false,
        sources: [],
      },
    });
  });
  await page.goto("/logs");
  await page.getByRole("button", { name: "Workspace menu" }).click();
  await page
    .getByRole("navigation", { name: "Workspace" })
    .getByRole("button", { name: "DNS troubleshooting" })
    .click();
  await page.getByRole("button", { name: "Choose time range" }).click();
  const sheet = page.getByRole("dialog", { name: "Query & filters" });
  await sheet.getByRole("textbox", { name: "Start" }).fill("2026-07-21T15:00");
  await sheet.getByRole("textbox", { name: "End" }).fill("2026-07-21T16:00");
  await expect
    .poll(
      async () =>
        (await sheet.getByRole("combobox", { name: "DNS sort order" }).boundingBox())?.height ?? 0,
    )
    .toBeGreaterThanOrEqual(44);
  await sheet.getByRole("button", { name: "Run query", exact: true }).click();
  await sheet.getByRole("button", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Change time range" }).click();
  await sheet.getByRole("textbox", { name: "DNS client" }).fill("10.0.0.4");
  await expect(sheet.getByRole("button", { name: "Run query", exact: true })).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Apply filters" })).toHaveCount(0);
  await sheet.getByRole("button", { name: "Run query", exact: true }).click();
  await sheet.getByRole("button", { name: "Show 5 results" }).click();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({ filters: { client: "10.0.0.4" } });
  await expect(page.getByRole("button", { name: "Query & filters (1)" })).toBeFocused();
  const search = page.getByRole("textbox", { name: "Domain or DNS search" });
  await search.fill("login");
  await expect(page.getByRole("region", { name: "DNS entries" }).getByRole("button")).toHaveCount(
    1,
  );
  await expect(
    page.getByText("Filtering loaded results. Run query to search the full range."),
  ).toBeVisible();
  await search.press("Enter");
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ filters: { search: "login" } });
  await expect(
    page.getByText("Filtering loaded results. Run query to search the full range."),
  ).toHaveCount(0);
  await search.fill("nomatch");
  await expect(page.getByRole("button", { name: "Reset filters" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Change time range" })).toHaveCount(0);
});
