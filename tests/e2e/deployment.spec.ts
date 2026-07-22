import { expect, test } from "@playwright/test";

import { enterAnonymousMode, openSettings } from "./support/logsWorkspace";

test("anonymous deployment bypasses application login", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveURL(/\/logs/, { timeout: 15_000 });
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
  await expect(page.getByRole("button", { name: "Category filter" })).toBeVisible();
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

test("anonymous request cannot query Log Analytics", async ({ request }) => {
  const response = await request.post("/api/log-analytics/query", {
    data: {
      filters: {
        action: "",
        category: [],
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
