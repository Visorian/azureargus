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
  await page.goto("/login");
  await page.getByRole("button", { name: "Use without login" }).click();
  await expect(page).toHaveURL(/\/logs/);
}

test("login page offers anonymous mode when enabled", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Azure Argus" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use without login" })).toBeVisible();
});

test("protected logs require a session and leaving anonymous mode ends it", async ({ page }) => {
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/login/);

  await page.getByRole("button", { name: "Use without login" }).click();
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText("Temporary session")).toBeVisible();
  await page.getByRole("button", { name: "Leave" }).click();

  await expect(page).toHaveURL(/\/login/);
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/login/);
});

test("anonymous mode can reach logs page", async ({ page }) => {
  await enterAnonymousMode(page);

  await expect(page.getByText("Event Hub connection")).toBeVisible();
  await expect(page.getByRole("button", { name: "Real-time analysis" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Log analysis" })).toBeDisabled();
  await expect(page.getByRole("table", { name: "Firewall logs" })).toBeVisible();
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

  const logRetentionSwitch = page.getByRole("switch", { name: "Local log retention" });
  const logRetentionInfo = page.getByRole("button", { name: "About local log retention" });
  await expect(logRetentionSwitch).toBeVisible();
  await logRetentionInfo.hover();
  await expect(
    page.getByRole("paragraph").filter({ hasText: "Keeps up to 100,000 parsed Real-time records" }),
  ).toBeVisible();
});

test("local log retention is opt-in and clearing is persistent", async ({ page }) => {
  await enterAnonymousMode(page);

  const logRetentionSwitch = page.getByRole("switch", { name: "Local log retention" });
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
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Use without login" }).click();
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
    { moduleUrl: LOG_HISTORY_STORE_MODULE_URL, records: [oldest, middle, newest] },
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
  await page.getByRole("button", { name: "Connect", exact: true }).click();

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

  const connectionStringInput = page.getByRole("textbox", { name: "Connection string*" });
  const rememberConnectionString = page.getByRole("checkbox", {
    name: "Remember connection string",
  });

  await expect(connectionStringInput).toHaveValue("");
  await expect(rememberConnectionString).not.toBeChecked();
  await connectionStringInput.fill(connectionString);
  await rememberConnectionString.check();

  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Use without login" }).click();
  await expect(connectionStringInput).toHaveValue(connectionString);
  await expect(rememberConnectionString).toBeChecked();

  await rememberConnectionString.uncheck();
  await page.reload();
  await page.getByRole("button", { name: "Use without login" }).click();
  await expect(connectionStringInput).toHaveValue("");
  await expect(rememberConnectionString).not.toBeChecked();
});

test("connection string remains opted in when browser storage removal fails", async ({ page }) => {
  const connectionString =
    "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";

  await enterAnonymousMode(page);

  const connectionStringInput = page.getByRole("textbox", { name: "Connection string*" });
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

  const connectionStringInput = page.getByRole("textbox", { name: "Connection string*" });
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
  await page.getByRole("button", { name: "Use without login" }).click();
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
