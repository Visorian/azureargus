import { resolve } from "node:path";

import { expect, type Page, test } from "@playwright/test";

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

test("anonymous deployment bypasses application login", async ({ page }) => {
  await page.goto("/login");

  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText("Temporary session")).toBeVisible();
  await expect(page.getByRole("button", { name: "Leave" })).toHaveCount(0);
});

test("anonymous deployment starts directly in logs", async ({ page }) => {
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText("Temporary session")).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: "Connection string" })).toBeDisabled();
  await expect(page.getByRole("textbox", { name: "Event Hub name" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "Remember connection string" })).toHaveCount(0);
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(page.getByText("1 visible / 1 received")).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Jul 12, 2026.*AZFWNetworkRule.*Allow.*TCP/ }),
  ).toBeVisible();
});

test("managed Log Analytics-only deployment starts in configured query mode", async ({ page }) => {
  await mockManagedDeployment(page, { eventHub: false, logAnalytics: true });
  await page.route("**/api/log-analytics/query", async (route) => {
    const requestBody = route.request().postDataJSON();
    expect(requestBody).not.toHaveProperty("workspaceId");
    await route.fulfill({
      contentType: "application/json",
      json: {
        limit: 1_000,
        records: [
          {
            action: "Allow",
            category: "AZFWNetworkRule",
            id: "managed-query-record",
            message: "managed-query-record",
            protocol: "TCP",
            raw: {},
            searchableText: "managed-query-record",
            timestamp: "2026-07-12T14:30:00.000Z",
          },
        ],
        truncated: false,
      },
    });
  });

  await page.goto("/logs");
  const dataSource = page.getByRole("group", { name: "Data source" });
  await expect(dataSource.getByRole("button", { name: "Live Event Hub" })).toBeDisabled();
  await expect(dataSource.getByRole("button", { name: "Log Analytics" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByRole("textbox", { name: "Workspace ID*" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect to Azure" })).toHaveCount(0);
  await page.getByRole("button", { name: "Run query" }).click();
  await expect(page.getByText("1 visible", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("row", { name: /Jul 12, 2026.*AZFWNetworkRule.*Allow.*TCP/ }),
  ).toBeVisible();
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
  await expect(page.getByRole("textbox", { name: "Workspace ID*" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect to Azure" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Run query" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Leave" })).toHaveCount(0);
});

test("anonymous mode can reach logs page", async ({ page }) => {
  await enterAnonymousMode(page);

  await expect(page.getByText("Live Event Hub settings")).toBeVisible();
  const dataSource = page.getByRole("group", { name: "Data source" });
  await expect(dataSource).toBeVisible();
  await expect(dataSource.getByRole("button", { name: "Live Event Hub" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(dataSource.getByRole("button", { name: "Log Analytics" })).toBeDisabled();
  await expect(
    page.getByText("Log Analytics delegated authentication is not configured."),
  ).toBeVisible();
  await expect(dataSource.getByText(/visible \/ .*received/)).toHaveCount(0);
  await expect(dataSource.getByRole("button", { name: "Clear", exact: true })).toHaveCount(0);
  await expect(page.getByText(/visible \/ .*received/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear", exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Firewall logs" })).toBeVisible();
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

  const collapseSidebar = page.getByRole("button", {
    name: "Collapse sidebar",
  });
  await collapseSidebar.focus();
  await expect(collapseSidebar).toBeFocused();
  await collapseSidebar.press("Enter");
  await expect(dataSource).toBeVisible();
  const expandSidebar = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expandSidebar).toBeVisible();
  await expandSidebar.focus();
  await expect(expandSidebar).toBeFocused();
  await expandSidebar.press("Enter");
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toBeVisible();

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

test("data source rail remains bounded at narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 812, width: 375 });
  await enterAnonymousMode(page);

  const dataSource = page.getByRole("group", { name: "Data source" });
  await expect(dataSource.getByRole("button", { name: "Live Event Hub" })).toBeVisible();
  await expect(dataSource.getByRole("button", { name: "Log Analytics" })).toBeVisible();
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(dataSource).toBeVisible();
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => ({
        horizontal: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        vertical: document.documentElement.scrollHeight <= document.documentElement.clientHeight,
      })),
    )
    .toEqual({ horizontal: true, vertical: true });
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
  await expect(connectionStringInput).toHaveValue(connectionString);
  await expect(rememberConnectionString).toBeChecked();

  await rememberConnectionString.uncheck();
  await page.reload();
  await expect(page).toHaveURL(/\/logs/);
  await expect(connectionStringInput).toHaveValue("");
  await expect(rememberConnectionString).not.toBeChecked();
});

test("connection string remains opted in when browser storage removal fails", async ({ page }) => {
  const connectionString =
    "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";

  await enterAnonymousMode(page);

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
