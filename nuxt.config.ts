const entraTenantId = process.env.NUXT_OIDC_ENTRA_TENANT_ID || "organizations";
const entraBaseUrl = `https://login.microsoftonline.com/${entraTenantId}/oauth2/v2.0`;

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
      databasePath: process.env.NUXT_IP_COUNTRY_DATABASE_PATH || ".data/dbip-country-lite.mmdb",
    },
    logAnalytics: {
      tenantId: process.env.NUXT_LOG_ANALYTICS_TENANT_ID || "",
      clientId: process.env.NUXT_LOG_ANALYTICS_CLIENT_ID || "",
      clientSecret: process.env.NUXT_LOG_ANALYTICS_CLIENT_SECRET || "",
      workspaceId: process.env.NUXT_LOG_ANALYTICS_WORKSPACE_ID || "",
    },
    public: {
      allowAnonymousMode: process.env.NUXT_PUBLIC_ALLOW_ANONYMOUS_MODE !== "false",
      defaultLookbackMinutes: Number(process.env.NUXT_PUBLIC_DEFAULT_LOOKBACK_MINUTES || 15),
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
        clientId: process.env.NUXT_OIDC_ENTRA_CLIENT_ID || "local-client-id",
        clientSecret: process.env.NUXT_OIDC_ENTRA_CLIENT_SECRET || "local-client-secret",
        redirectUri:
          process.env.NUXT_OIDC_ENTRA_REDIRECT_URI || "http://localhost:3000/auth/entra/callback",
        authorizationUrl: `${entraBaseUrl}/authorize`,
        tokenUrl: `${entraBaseUrl}/token`,
        logoutUrl: `${entraBaseUrl}/logout`,
        nonce: true,
        pkce: true,
        state: true,
        scope: ["openid", "profile", "email", "offline_access"],
        responseType: "code id_token",
        optionalClaims: [
          "preferred_username",
          "family_name",
          "given_name",
          "groups",
          "tid",
          "roles",
        ],
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
