import { execFileSync } from 'node:child_process'
import type { ServerResponse } from 'node:http'

import type { Plugin } from 'vite'

const MSAL_REDIRECT_MODULE_ID = 'virtual:azure-argus-msal-redirect'
const RESOLVED_MSAL_REDIRECT_MODULE_ID = `\0${MSAL_REDIRECT_MODULE_ID}`
const MSAL_REDIRECT_ASSET_PATH = '/_nuxt/log-analytics-redirect.js'

function nonEmptyEnv(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

function sourceRevision(): string | undefined {
  const revision = nonEmptyEnv('VCS_REF')
  if (revision !== undefined) {
    return revision
  }
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: import.meta.dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

function createMsalRedirectBridgePlugin(): Plugin {
  let isBuild = false

  return {
    name: 'azure-argus:msal-redirect-bridge',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    configureServer(server) {
      const serveBridge = async (
        response: ServerResponse,
        next: (error?: unknown) => void,
      ): Promise<void> => {
        try {
          const result = await server.transformRequest(MSAL_REDIRECT_MODULE_ID)
          if (!result) {
            next()
            return
          }
          response.setHeader('content-type', 'text/javascript; charset=utf-8')
          response.end(result.code)
        } catch (error) {
          next(error)
        }
      }
      server.middlewares.use(MSAL_REDIRECT_ASSET_PATH, (_request, response, next) => {
        void serveBridge(response, next)
      })
    },
    buildStart() {
      if (!isBuild) {
        return
      }
      this.emitFile({
        type: 'chunk',
        id: MSAL_REDIRECT_MODULE_ID,
        fileName: '_nuxt/log-analytics-redirect.js',
      })
    },
    generateBundle(_options, bundle) {
      const bridgeChunk = bundle[MSAL_REDIRECT_ASSET_PATH.slice(1)]
      if (bridgeChunk?.type !== 'chunk') {
        this.error('MSAL redirect bridge chunk was not generated')
      }
      // Nuxt injects emitted entry chunks into every SPA page, so retain the
      // bundled file while removing its application-entry semantics.
      // oxlint-disable-next-line typescript/no-dynamic-delete -- Rollup removes chunks by deleting them from the bundle.
      delete bundle[bridgeChunk.fileName]
      this.emitFile({
        type: 'prebuilt-chunk',
        fileName: bridgeChunk.fileName,
        code: bridgeChunk.code,
        map: bridgeChunk.map ?? undefined,
        isEntry: false,
      })
    },
    resolveId(id) {
      return id === MSAL_REDIRECT_MODULE_ID ? RESOLVED_MSAL_REDIRECT_MODULE_ID : null
    },
    load(id) {
      if (id !== RESOLVED_MSAL_REDIRECT_MODULE_ID) {
        return null
      }
      return `try {
  const preference = window.localStorage.getItem("nuxt-color-mode");
  if (preference === "light" || preference === "dark") {
    document.documentElement.classList.add(preference);
  }
} catch {}

function showOutcome(title, text, state) {
  document.title = title;
  const heading = document.getElementById("status-title");
  if (heading) heading.textContent = title;
  const message = document.querySelector("p");
  if (message) message.textContent = text;
  const status = document.querySelector(".callback-status");
  if (status) {
    status.dataset.state = state;
    const path = status.querySelector("path");
    if (path) path.setAttribute("d", state === "success"
      ? "M22 11.1V12a10 10 0 1 1-5.9-9.1 M22 4 12 14l-3-3"
      : "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0 M8 8l8 8 M16 8l-8 8");
  }
}

const parameters = new URLSearchParams(window.location.search);
if (parameters.get("state") === "azure-argus-admin-consent") {
  const granted = parameters.get("admin_consent")?.toLowerCase() === "true";
  showOutcome(
    granted ? "Tenant consent granted" : "Tenant consent not granted",
    granted
      ? "Tenant consent granted. Return to Azure Argus to continue."
      : "Tenant consent was not granted. Return to Azure Argus and try again.",
    granted ? "success" : "error"
  );
} else {
  void import("@azure/msal-browser/redirect-bridge").then(({ broadcastResponseToMainFrame }) => {
    return broadcastResponseToMainFrame();
  }).catch(() => {
    showOutcome(
      "Authentication response unavailable",
      "Azure authentication response could not be processed. Return to Azure Argus and try again.",
      "error"
    );
  });
}`
    },
  }
}

export default defineNuxtConfig({
  modules: ['@nuxt/ui', 'nuxt-oidc-auth', '@visorian/code-standards/nuxt'],
  ssr: false,
  devtools: { enabled: false },
  app: {
    head: {
      title: 'Azure Argus',
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'stylesheet', href: '/styles/design-tokens.css' }],
      meta: [
        {
          name: 'description',
          content:
            'Analyze Azure Firewall logs, troubleshoot DNS, and trace firewall policy rules.',
        },
      ],
    },
  },
  css: ['~/assets/css/main.css'],
  ui: { experimental: { componentDetection: true } },
  appConfig: {
    versionNumber: nonEmptyEnv('VERSION_NUMBER') ?? nonEmptyEnv('npm_package_version') ?? 'dev',
    sourceRevision: sourceRevision(),
  },
  runtimeConfig: {
    ipCountry: {
      databasePath: '.data/dbip-country-lite.mmdb',
    },
    eventHub: {
      connectionString: '',
      name: '',
    },
    logAnalytics: {
      tenantId: '',
      clientId: '',
      clientSecret: '',
      workspaceId: '',
    },
    public: {
      defaultLookbackMinutes: 15,
      logAnalyticsDelegated: {
        clientId: '',
      },
      siteName: 'Azure Argus',
    },
  },
  future: { compatibilityVersion: 5 },
  experimental: { nitroAutoImports: true },
  compatibilityDate: '2026-07-09',
  vite: {
    define: {
      global: 'globalThis',
    },
    resolve: {
      alias: {
        buffer: 'buffer',
        os: 'os-browserify/browser',
        path: 'path-browserify',
        process: 'process/browser',
      },
    },
    optimizeDeps: {
      exclude: ['@azure/msal-browser/redirect-bridge'],
      include: ['buffer', 'os-browserify/browser', 'path-browserify', 'process'],
    },
    plugins: [
      createMsalRedirectBridgePlugin(),
      {
        name: 'azure-argus:vite-checker-runtime-shim',
        apply: 'serve',
        enforce: 'pre',
        resolveId(id) {
          if (
            id === '/@vite-plugin-checker-runtime-entry' ||
            id.endsWith('/@vite-plugin-checker-runtime-entry')
          ) {
            return 'virtual:@vite-plugin-checker-runtime-entry'
          }
          if (
            id === '/@vite-plugin-checker-runtime' ||
            id.endsWith('/@vite-plugin-checker-runtime')
          ) {
            return 'virtual:@vite-plugin-checker-runtime'
          }

          return null
        },
      },
    ],
  },
  typescript: {
    typeCheck: true,
  },
  icon: {
    clientBundle: {
      scan: { globInclude: ['app/**/*.{vue,ts}'] },
    },
  },
  oidc: {
    defaultProvider: 'entra',
    providers: {
      entra: {
        clientId: '',
        clientSecret: '',
        redirectUri: '',
        authorizationUrl: '',
        tokenUrl: '',
        logoutUrl: '',
        nonce: true,
        pkce: true,
        state: true,
        scope: ['openid', 'profile', 'email', 'offline_access'],
        responseType: 'code id_token',
        optionalClaims: ['preferred_username', 'family_name', 'given_name'],
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
})
