import { expect, type Page } from "@playwright/test";

export async function enterAnonymousMode(page: Page) {
  await page.goto("/logs");
  await expect(page).toHaveURL(/\/logs/);
  await expect(page.getByRole("region", { name: "Data source" })).toBeVisible();
}

export async function openSettings(page: Page) {
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true });
  const settingsDrawer = page.locator("#logs-settings-drawer");
  if ((await settingsButton.getAttribute("aria-expanded")) !== "true") {
    await settingsButton.click();
  }
  await expect(settingsButton).toHaveAttribute("aria-expanded", "true");
  await expect(settingsDrawer).toBeVisible();
  return settingsDrawer;
}
