import { expect, type Page, test } from "@playwright/test";

import { EVENT_HUB_CONNECTION_STRING_STORAGE_KEY } from "../../app/utils/eventHubConnectionStorage";
import { LOG_HISTORY_DB_NAME, LOG_HISTORY_STORE_NAME } from "../../app/utils/logHistoryRecord";
import { mockManagedDeployment } from "./support/deployment";
import { enterAnonymousMode, openSettings } from "./support/logsWorkspace";
import {
  enqueueManagedEventHubEnvelope,
  mockManagedEventHubStream,
} from "./support/managedEventHub";

const LOGS_URL_PATTERN = /\/logs/;
const RETENTION_OFF_ROW_PATTERN = /Jul 21, 2026, 10:00:00 AZFWNetworkRule/;
const RETENTION_ON_ROW_PATTERN = /Jul 21, 2026, 10:01:00 AZFWNetworkRule/;

function getStoredLogCount(page: Page) {
  return page.evaluate(
    ({ databaseName, storeName }) =>
      new Promise<number>((resolveCount, rejectCount) => {
        const openRequest = indexedDB.open(databaseName);
        openRequest.onerror = () => rejectCount(openRequest.error);
        openRequest.onsuccess = () => {
          const database = openRequest.result;
          const countRequest = database.transaction(storeName).objectStore(storeName).count();
          countRequest.onerror = () => {
            database.close();
            rejectCount(countRequest.error);
          };
          countRequest.onsuccess = () => {
            database.close();
            resolveCount(countRequest.result);
          };
        };
      }),
    { databaseName: LOG_HISTORY_DB_NAME, storeName: LOG_HISTORY_STORE_NAME },
  );
}

test("local log retention is opt-in and clearing is persistent", async ({ page }) => {
  await mockManagedDeployment(page, { eventHub: true, logAnalytics: false });
  await mockManagedEventHubStream(page);

  await page.goto("/logs");
  let settingsDrawer = await openSettings(page);

  const logRetentionSwitch = page.getByRole("switch", {
    name: "Local log retention",
  });
  await expect(logRetentionSwitch).not.toBeChecked();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          records: [
            {
              Action: "Allow",
              Category: "AZFWNetworkRule",
              msg: "retention-off-record",
              Protocol: "TCP",
              TimeGenerated: "2026-07-21T10:00:00.000Z",
            },
          ],
        },
        enqueuedTimeUtc: "2026-07-21T10:00:01.000Z",
        partitionId: "0",
        sequenceNumber: 1,
      },
    ],
  });
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByText("1 visible / 1 received")).toBeVisible();
  await expect(page.getByRole("row", { name: RETENTION_OFF_ROW_PATTERN })).toBeVisible();
  settingsDrawer = await openSettings(page);
  await settingsDrawer.getByRole("button", { name: "Disconnect" }).click();
  await settingsDrawer.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    page.getByRole("group", { name: "All logs status and actions" }).getByRole("status"),
  ).toHaveText("connected");
  await expect.poll(() => getStoredLogCount(page)).toBe(0);

  await page.reload();
  await expect(page).toHaveURL(LOGS_URL_PATTERN);
  settingsDrawer = await openSettings(page);
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect(page.getByText("No logs received")).toBeVisible();

  await logRetentionSwitch.click();
  await expect(logRetentionSwitch).toBeChecked();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await enqueueManagedEventHubEnvelope(page, {
    type: "events",
    events: [
      {
        body: {
          records: [
            {
              Action: "Allow",
              Category: "AZFWNetworkRule",
              msg: "retention-on-record",
              Protocol: "TCP",
              TimeGenerated: "2026-07-21T10:01:00.000Z",
            },
          ],
        },
        enqueuedTimeUtc: "2026-07-21T10:01:01.000Z",
        partitionId: "0",
        sequenceNumber: 2,
      },
    ],
  });
  await settingsDrawer.getByRole("button", { name: "Close settings" }).click();
  await expect(page.getByText("1 visible / 1 received")).toBeVisible();
  await expect(page.getByRole("row", { name: RETENTION_ON_ROW_PATTERN })).toBeVisible();
  await expect.poll(() => getStoredLogCount(page)).toBe(1);

  await openSettings(page);
  await logRetentionSwitch.click();
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect.poll(() => getStoredLogCount(page)).toBe(0);
  await page.reload();
  await expect(page).toHaveURL(LOGS_URL_PATTERN);
  await openSettings(page);
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect(page.getByText("No logs received")).toBeVisible();
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
