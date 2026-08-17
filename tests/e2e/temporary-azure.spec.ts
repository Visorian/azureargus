import { expect, test } from "@playwright/test";

import { openSettings } from "./support/logsWorkspace";
import {
  mockTemporaryAzure,
  temporaryAzureTokens,
  temporaryAzureWorkspaceId,
} from "./support/temporaryAzure";

const readinessSummary = /Dedicated tables 7\/7 available/;
const temporaryFirewallRow = /AZFWNetworkRule.*10\.0\.0\.4.*10\.0\.0\.53/;
const removedDelegatedRoutes = [
  { method: "GET", path: "/api/log-analytics/delegated-access" },
  { method: "POST", path: "/api/log-analytics/delegated-query" },
  { method: "POST", path: "/api/log-analytics/delegated-dns/readiness" },
  { method: "POST", path: "/api/log-analytics/delegated-dns/list" },
  { method: "POST", path: "/api/log-analytics/delegated-dns/detail" },
] as const;

test("removed delegated Log Analytics routes return 404", async ({ request }) => {
  for (const route of removedDelegatedRoutes) {
    const response = await request.fetch(route.path, { method: route.method });
    expect(response.status(), route.path).toBe(404);
  }
});

test("temporary Azure flows stay browser-direct", async ({ page }) => {
  const traffic = await mockTemporaryAzure(page);

  await page.goto("/logs");
  await page.getByRole("button", { name: "Log Analytics" }).click();
  let settingsDrawer = await openSettings(page);
  await settingsDrawer.getByRole("button", { name: "Connect to Azure" }).click();

  await expect(settingsDrawer.getByText("Connected as temporary@example.com.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    settingsDrawer.getByText("Log Analytics access available for selected directory."),
  ).toBeVisible();
  await expect(settingsDrawer.getByText(temporaryAzureWorkspaceId, { exact: true })).toBeVisible();
  await expect(settingsDrawer.getByText(readinessSummary)).toBeVisible();

  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByText("1 visible", { exact: true })).toBeVisible();
  await expect(page.getByRole("row", { name: temporaryFirewallRow })).toBeVisible();

  await page.getByRole("button", { name: "DNS troubleshooting" }).click();
  settingsDrawer = await openSettings(page);
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await page.getByRole("button", { name: "Run query" }).click();
  const detailButton = page.getByRole("button", { name: "Open DNS details for example.com." });
  await expect(detailButton).toBeVisible();
  await detailButton.click();
  const detailDialog = page.getByRole("dialog", { name: "DNS resolution detail" });
  await expect(detailDialog).toBeVisible();
  await expect(
    detailDialog.getByText("NOERROR — No protocol error", { exact: true }),
  ).toBeVisible();

  const managementRequests = traffic.azureRequests.filter(
    (request) => request.origin === "https://management.azure.com",
  );
  const logAnalyticsRequests = traffic.azureRequests.filter(
    (request) => request.origin === "https://api.loganalytics.azure.com",
  );
  expect(managementRequests.map((request) => request.pathname)).toEqual(
    expect.arrayContaining([
      "/tenants",
      "/subscriptions",
      "/providers/Microsoft.ResourceGraph/resources",
    ]),
  );
  expect(managementRequests.length).toBeGreaterThanOrEqual(5);
  expect(
    managementRequests.every(
      (request) => request.authorization === `Bearer ${temporaryAzureTokens.management}`,
    ),
  ).toBe(true);
  expect(new Set(logAnalyticsRequests.map((request) => request.pathname))).toEqual(
    new Set([`/v1/workspaces/${temporaryAzureWorkspaceId}/query`]),
  );
  expect(
    logAnalyticsRequests.every(
      (request) => request.authorization === `Bearer ${temporaryAzureTokens.logAnalytics}`,
    ),
  ).toBe(true);
  expect(new Set(traffic.externalRequests.map((request) => request.origin))).toEqual(
    new Set([
      "https://api.iconify.design",
      "https://api.loganalytics.azure.com",
      "https://login.microsoftonline.com",
      "https://management.azure.com",
    ]),
  );
  expect(
    traffic.externalRequests
      .filter((request) => request.origin === "https://api.iconify.design")
      .every(
        (request) =>
          request.authorization === null && request.body === null && request.method === "GET",
      ),
  ).toBe(true);
  expect(
    traffic.sameOriginRequests.filter((request) =>
      request.pathname.startsWith("/api/log-analytics/"),
    ),
  ).toEqual([]);
  expect(traffic.sameOriginRequests.every((request) => request.authorization === null)).toBe(true);
});
