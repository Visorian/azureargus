import { expect, test } from "@playwright/test";

import { openSettings } from "./support/logsWorkspace";

test("application routes keep the Azure Argus title without loading the redirect bridge", async ({
  page,
}) => {
  const redirectBridgeRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/_nuxt/log-analytics-redirect.js") {
      redirectBridgeRequests.push(request.url());
    }
  });

  await page.goto("/");
  await expect(page).toHaveTitle("Azure Argus");

  await page.goto("/logs");
  await expect(page).toHaveTitle("Azure Argus");
  await openSettings(page);
  await expect(page).toHaveTitle("Azure Argus");
  expect(redirectBridgeRequests).toEqual([]);
});

test("redirect page processes the tenant consent response", async ({ page }) => {
  await page.goto(
    "/log-analytics-redirect.html?state=azure-argus-admin-consent&admin_consent=true",
  );

  await expect(page).toHaveTitle("Tenant consent granted");
  await expect(
    page.getByText("Tenant consent granted. Return to Azure Argus to continue."),
  ).toBeVisible();
});
