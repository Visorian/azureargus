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
    logAnalytics: {
      tenantId: "",
      clientId: "",
      clientSecret: "",
      workspaceId: "",
    },
    public: {
      allowAnonymousMode: true,
      defaultLookbackMinutes: 15,
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
