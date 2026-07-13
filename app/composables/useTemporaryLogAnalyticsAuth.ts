import type {
  AccountInfo,
  IPublicClientApplication,
  PublicClientApplication,
} from "@azure/msal-browser";

const LOG_ANALYTICS_SCOPES = ["https://api.loganalytics.io/Data.Read"];
const REDIRECT_PATH = "/log-analytics-redirect.html";

let clientPromise: Promise<IPublicClientApplication> | null = null;
let activeAccount: AccountInfo | null = null;
let operationGeneration = 0;

class StaleTemporaryAuthOperation extends Error {}

export function useTemporaryLogAnalyticsAuth() {
  const runtimeConfig = useRuntimeConfig();
  const connected = useState("temporary-log-analytics-connected", () => false);
  const status = useState<"idle" | "connecting" | "connected" | "error">(
    "temporary-log-analytics-status",
    () => "idle",
  );
  const lastError = useState<string | null>("temporary-log-analytics-error", () => null);

  async function getClient() {
    if (clientPromise !== null) {
      return clientPromise;
    }

    const { BrowserCacheLocation, PublicClientApplication: MsalClient } =
      await import("@azure/msal-browser");
    const tenantId = runtimeConfig.public.logAnalyticsDelegated.tenantId;
    const clientId = runtimeConfig.public.logAnalyticsDelegated.clientId;
    const redirectUri = `${window.location.origin}${REDIRECT_PATH}`;
    const initializingClient = (async () => {
      const client: PublicClientApplication = new MsalClient({
        auth: {
          authority: `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}`,
          clientId,
          redirectUri,
        },
        cache: {
          cacheLocation: BrowserCacheLocation.MemoryStorage,
        },
      });
      await client.initialize();
      return client;
    })();
    clientPromise = initializingClient;
    try {
      return await initializingClient;
    } catch (error: unknown) {
      if (clientPromise === initializingClient) {
        clientPromise = null;
      }
      throw error;
    }
  }

  async function connect() {
    const generation = ++operationGeneration;
    status.value = "connecting";
    lastError.value = null;
    try {
      const client = await getClient();
      const result = await client.loginPopup({
        redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
        scopes: LOG_ANALYTICS_SCOPES,
      });
      if (generation !== operationGeneration) {
        await client.clearCache({ account: result.account });
        return false;
      }
      activeAccount = result.account;
      connected.value = true;
      status.value = "connected";
      return true;
    } catch {
      if (generation !== operationGeneration) {
        return false;
      }
      activeAccount = null;
      connected.value = false;
      status.value = "error";
      lastError.value = "Azure authentication failed.";
      return false;
    }
  }

  async function getAccessToken(allowInteractive = false) {
    if (!activeAccount || !connected.value) {
      throw new Error("Connect to Azure before running Log Analytics query.");
    }

    const generation = operationGeneration;
    try {
      const client = await getClient();
      const result = await client.acquireTokenSilent({
        account: activeAccount,
        scopes: LOG_ANALYTICS_SCOPES,
      });
      if (generation !== operationGeneration) {
        throw new StaleTemporaryAuthOperation();
      }
      return result.accessToken;
    } catch (error: unknown) {
      if (error instanceof StaleTemporaryAuthOperation || generation !== operationGeneration) {
        throw error;
      }
      const { InteractionRequiredAuthError } = await import("@azure/msal-browser");
      if (allowInteractive && error instanceof InteractionRequiredAuthError) {
        try {
          const client = await getClient();
          const result = await client.acquireTokenPopup({
            account: activeAccount,
            redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
            scopes: LOG_ANALYTICS_SCOPES,
          });
          if (generation !== operationGeneration) {
            await client.clearCache({ account: result.account });
            throw new StaleTemporaryAuthOperation();
          }
          return result.accessToken;
        } catch (popupError: unknown) {
          if (
            popupError instanceof StaleTemporaryAuthOperation ||
            generation !== operationGeneration
          ) {
            throw popupError;
          }
          activeAccount = null;
          connected.value = false;
          status.value = "error";
          lastError.value = "Azure token acquisition failed. Connect again.";
          throw new Error(lastError.value);
        }
      }

      activeAccount = null;
      connected.value = false;
      status.value = "error";
      lastError.value =
        error instanceof InteractionRequiredAuthError
          ? "Azure authentication expired. Connect again."
          : "Azure token acquisition failed. Connect again.";
      throw new Error(lastError.value);
    }
  }

  async function disconnect() {
    const account = activeAccount;
    operationGeneration += 1;
    activeAccount = null;
    connected.value = false;
    status.value = "idle";
    lastError.value = null;

    if (clientPromise !== null) {
      const client = await clientPromise;
      await client.clearCache(account ? { account } : undefined);
    }
  }

  onScopeDispose(() => {
    void disconnect();
  });

  return {
    connect,
    connected,
    disconnect,
    getAccessToken,
    lastError,
    status,
  };
}
