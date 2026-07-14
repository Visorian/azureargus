import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);
const APP_ASSET_PATTERN = /entry\.js|app\.js|router|__NUXT__/i;
const REDIRECT_BRIDGE_PATTERN = /return `([^`]*@azure\/msal-browser\/redirect-bridge[^`]*)`;/;
const APP_FRAMEWORK_PATTERN = /nuxt|vue|router/i;

describe("MSAL redirect bridge", () => {
  it("serves a dedicated page that loads only the bridge asset", async () => {
    const html = await readFile(new URL("public/log-analytics-redirect.html", root), "utf8");

    expect(html).toContain(
      '<script type="module" src="/_nuxt/log-analytics-redirect.js"></script>',
    );
    expect(html).not.toMatch(APP_ASSET_PATTERN);
  });

  it("builds the bridge asset from the MSAL redirect helper only", async () => {
    const config = await readFile(new URL("nuxt.config.ts", root), "utf8");
    const moduleSource = config.match(REDIRECT_BRIDGE_PATTERN)?.[1];

    expect(moduleSource).toBeDefined();
    expect(moduleSource).toContain('import("@azure/msal-browser/redirect-bridge")');
    expect(moduleSource).toContain("return broadcastResponseToMainFrame();");
    expect(moduleSource).toContain("Azure authentication response could not be processed.");
    expect(moduleSource).toContain('parameters.get("state") === "azure-argus-admin-consent"');
    expect(moduleSource).toContain("Tenant consent granted. Return to Azure Argus to continue.");
    expect(moduleSource).not.toMatch(APP_FRAMEWORK_PATTERN);
  });

  it("keeps the bridge out of Vite dependency prebundling", async () => {
    const config = await readFile(new URL("nuxt.config.ts", root), "utf8");

    expect(config).toContain('exclude: ["@azure/msal-browser/redirect-bridge"]');
  });
});
