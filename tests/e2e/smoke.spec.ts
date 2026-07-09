import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("No logs received")).toBeVisible();
});
