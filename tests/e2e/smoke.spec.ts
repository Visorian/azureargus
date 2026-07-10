import { expect, type Page, test } from "@playwright/test";

import {
  LOG_HISTORY_ACTION_INDEX,
  LOG_HISTORY_CATEGORY_INDEX,
  LOG_HISTORY_DB_NAME,
  LOG_HISTORY_DB_VERSION,
  LOG_HISTORY_PROTOCOL_INDEX,
  LOG_HISTORY_STORE_NAME,
  LOG_HISTORY_TIMESTAMP_INDEX,
} from "../../app/utils/logHistoryRecord";

async function seedLogHistory(page: Page) {
  await page.evaluate(
    async ({ dbName, dbVersion, indexes, storeName }) => {
      const request = indexedDB.open(dbName, dbVersion);

      await new Promise<void>((resolve, reject) => {
        request.onupgradeneeded = () => {
          const database = request.result;
          const store = database.objectStoreNames.contains(storeName)
            ? request.transaction?.objectStore(storeName)
            : database.createObjectStore(storeName, { keyPath: "id" });

          if (!store) {
            reject(new Error("Could not create IndexedDB log history test store."));
            return;
          }

          for (const index of indexes) {
            if (!store.indexNames.contains(index.name)) {
              store.createIndex(index.name, index.keyPath, { unique: false });
            }
          }
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });

      const database = request.result;
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readwrite");
        transaction.objectStore(storeName).put({
          action: "Allow",
          category: "test",
          id: `seed-${Date.now()}`,
          message: "seed",
          protocol: "TCP",
          searchableText: "seed",
          timestamp: new Date().toISOString(),
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
    },
    {
      dbName: LOG_HISTORY_DB_NAME,
      dbVersion: LOG_HISTORY_DB_VERSION,
      indexes: [
        { keyPath: "timestamp", name: LOG_HISTORY_TIMESTAMP_INDEX },
        { keyPath: "category", name: LOG_HISTORY_CATEGORY_INDEX },
        { keyPath: "action", name: LOG_HISTORY_ACTION_INDEX },
        { keyPath: "protocol", name: LOG_HISTORY_PROTOCOL_INDEX },
      ],
      storeName: LOG_HISTORY_STORE_NAME,
    },
  );
}

async function countLogHistory(page: Page) {
  return page.evaluate(
    async ({ dbName, dbVersion, storeName }) => {
      const request = indexedDB.open(dbName, dbVersion);

      await new Promise<void>((resolve, reject) => {
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });

      const database = request.result;
      const count = await new Promise<number>((resolve, reject) => {
        const transaction = database.transaction(storeName, "readonly");
        const countRequest = transaction.objectStore(storeName).count();
        countRequest.onsuccess = () => resolve(countRequest.result);
        countRequest.onerror = () => reject(countRequest.error);
      });
      database.close();
      return count;
    },
    {
      dbName: LOG_HISTORY_DB_NAME,
      dbVersion: LOG_HISTORY_DB_VERSION,
      storeName: LOG_HISTORY_STORE_NAME,
    },
  );
}

test("login page offers anonymous mode when enabled", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Azure Argus" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use without login" })).toBeVisible();
});

test("anonymous mode can reach logs page", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Use without login" }).click();

  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByText("Event Hub connection")).toBeVisible();
  const logRetentionSwitch = page.getByRole("switch", { name: "Local log retention" });
  await expect(logRetentionSwitch).toBeVisible();
  await expect(logRetentionSwitch).not.toBeChecked();
  await seedLogHistory(page);
  await expect.poll(() => countLogHistory(page)).toBe(1);
  await logRetentionSwitch.click();
  await expect(logRetentionSwitch).toBeChecked();
  await logRetentionSwitch.click();
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect.poll(() => countLogHistory(page)).toBe(0);

  await logRetentionSwitch.click();
  await seedLogHistory(page);
  await expect.poll(() => countLogHistory(page)).toBe(1);
  await page.reload();
  await expect(page).toHaveURL(/\/login/);
  await page.getByRole("button", { name: "Use without login" }).click();
  await expect(page).toHaveURL(/\/logs/);
  await expect(logRetentionSwitch).not.toBeChecked();
  await expect.poll(() => countLogHistory(page)).toBe(0);
  await expect(page.getByText("No logs received")).toBeVisible();
});
