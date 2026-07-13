import { readFile } from "node:fs/promises";

const root = new URL("../../", import.meta.url);

describe("MSAL redirect bridge", () => {
  it("serves a dedicated page that loads only the bridge asset", async () => {
    const html = await readFile(new URL("public/log-analytics-redirect.html", root), "utf8");

    expect(html).toContain(
      '<script type="module" src="/_nuxt/log-analytics-redirect.js"></script>',
    );
    expect(html).not.toMatch(/entry\.js|app\.js|router|__NUXT__/i);
  });

  it("builds the bridge asset from the MSAL redirect helper only", async () => {
    const config = await readFile(new URL("nuxt.config.ts", root), "utf8");
    const moduleSource = config.match(
      /return `([^`]*@azure\/msal-browser\/redirect-bridge[^`]*)`;/,
    )?.[1];

    expect(moduleSource).toBeDefined();
    expect(moduleSource).toContain(
      'import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";',
    );
    expect(moduleSource).toContain("void broadcastResponseToMainFrame();");
    expect(moduleSource).not.toMatch(/nuxt|vue|router/i);
  });
});
