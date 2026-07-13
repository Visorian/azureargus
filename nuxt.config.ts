import type { Plugin } from "vite";

const MSAL_REDIRECT_MODULE_ID = "virtual:azure-argus-msal-redirect";
const RESOLVED_MSAL_REDIRECT_MODULE_ID = `\0${MSAL_REDIRECT_MODULE_ID}`;
const MSAL_REDIRECT_ASSET_PATH = "/_nuxt/log-analytics-redirect.js";

function createMsalRedirectBridgePlugin(): Plugin {
  let isBuild = false;

  return {
    name: "azure-argus:msal-redirect-bridge",
    configResolved(config) {
      isBuild = config.command === "build";
    },
    configureServer(server) {
      server.middlewares.use(MSAL_REDIRECT_ASSET_PATH, async (_request, response, next) => {
        const result = await server.transformRequest(MSAL_REDIRECT_MODULE_ID);
        if (!result) {
          next();
          return;
        }
        response.setHeader("content-type", "text/javascript; charset=utf-8");
        response.end(result.code);
      });
    },
    buildStart() {
      if (!isBuild) {
        return;
      }
      this.emitFile({
        type: "chunk",
        id: MSAL_REDIRECT_MODULE_ID,
        fileName: "_nuxt/log-analytics-redirect.js",
      });
    },
    resolveId(id) {
      return id === MSAL_REDIRECT_MODULE_ID ? RESOLVED_MSAL_REDIRECT_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_MSAL_REDIRECT_MODULE_ID) {
        return null;
      }
      return `import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
void broadcastResponseToMainFrame();`;
    },
  };
}

export default defineNuxtConfig({
  modules: ["@nuxt/ui", "nuxt-oidc-auth"],
  ssr: false,
  devtools: { enabled: false },
  css: ["~/assets/css/main.css"],
  compatibilityDate: "2026-07-09",
  appConfig: {
    versionNumber: process.env.VERSION_NUMBER || process.env.npm_package_version || "dev",
  },
  runtimeConfig: {
    ipCountry: {
      databasePath: ".data/dbip-country-lite.mmdb",
    },
    eventHub: {
      connectionString: "",
      name: "",
    },
    logAnalytics: {
      tenantId: "",
      clientId: "",
      clientSecret: "",
      workspaceId: "",
    },
    public: {
      defaultLookbackMinutes: 15,
      logAnalyticsDelegated: {
        tenantId: "",
        clientId: "",
      },
      siteName: "Azure Argus",
    },
  },
  typescript: {
    typeCheck: true,
  },
  vite: {
    define: {
      global: "globalThis",
    },
    resolve: {
      alias: {
        buffer: "buffer",
        os: "os-browserify/browser",
        path: "path-browserify",
        process: "process/browser",
      },
    },
    optimizeDeps: {
      include: ["buffer", "os-browserify/browser", "path-browserify", "process"],
    },
    plugins: [
      createMsalRedirectBridgePlugin(),
      {
        name: "azure-argus:vite-checker-runtime-shim",
        apply: "serve",
        enforce: "pre",
        resolveId(id) {
          if (
            id === "/@vite-plugin-checker-runtime-entry" ||
            id.endsWith("/@vite-plugin-checker-runtime-entry")
          ) {
            return "virtual:@vite-plugin-checker-runtime-entry";
          }
          if (
            id === "/@vite-plugin-checker-runtime" ||
            id.endsWith("/@vite-plugin-checker-runtime")
          ) {
            return "virtual:@vite-plugin-checker-runtime";
          }

          return null;
        },
      },
    ],
  },
  icon: {
    clientBundle: {
      scan: true,
    },
  },
  oidc: {
    defaultProvider: "entra",
    providers: {
      entra: {
        clientId: "",
        clientSecret: "",
        redirectUri: "",
        authorizationUrl: "",
        tokenUrl: "",
        logoutUrl: "",
        nonce: true,
        pkce: true,
        state: true,
        scope: ["openid", "profile", "email", "offline_access"],
        responseType: "code id_token",
        optionalClaims: ["preferred_username", "family_name", "given_name"],
      },
    },
    session: {
      automaticRefresh: true,
      expirationCheck: true,
      maxAge: 60 * 60 * 24,
    },
    middleware: {
      globalMiddlewareEnabled: false,
      customLoginPage: true,
    },
  },
});
