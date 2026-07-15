import type {
  AccountInfo,
  IPublicClientApplication,
  PublicClientApplication,
} from "@azure/msal-browser";
import { isEntraId } from "~/utils/logAnalyticsOnboarding";

const LOG_ANALYTICS_SCOPES = ["https://api.loganalytics.io/Data.Read"];
const AZURE_MANAGEMENT_SCOPES = ["https://management.azure.com/user_impersonation"];
const ORGANIZATIONS_AUTHORITY = "https://login.microsoftonline.com/organizations";
const REDIRECT_PATH = "/log-analytics-redirect.html";
const POPUP_CLOSE_POLL_INTERVAL_MS = 500;

let clientPromise: Promise<IPublicClientApplication> | null = null;
let activeAccount: AccountInfo | null = null;
let activeTenantId: string | null = null;
let operationGeneration = 0;
let authorizationGeneration = 0;

class StaleTemporaryAuthOperation extends Error {}

function hasPopupClosedState(value: unknown): value is { readonly closed: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "closed" in value &&
    typeof value.closed === "boolean"
  );
}

function getPopupWindowState(payload: unknown): { readonly closed: boolean } | null {
  if (typeof payload !== "object" || payload === null || !("popupWindow" in payload)) {
    return null;
  }
  const popupWindow = payload.popupWindow;
  return hasPopupClosedState(popupWindow) ? popupWindow : null;
}

export function useTemporaryLogAnalyticsAuth() {
  const runtimeConfig = useRuntimeConfig();
  const connected = useState("temporary-log-analytics-connected", () => false);
  const status = useState<"idle" | "connecting" | "connected" | "error">(
    "temporary-log-analytics-status",
    () => "idle",
  );
  const authorized = useState("temporary-log-analytics-authorized", () => false);
  const lastError = useState<string | null>("temporary-log-analytics-error", () => null);

  function invalidateAuthorization() {
    authorizationGeneration += 1;
    authorized.value = false;
    lastError.value = null;
  }

  async function getClient() {
    if (clientPromise !== null) {
      return clientPromise;
    }

    const { BrowserCacheLocation, PublicClientApplication: MsalClient } =
      await import("@azure/msal-browser");
    const clientId = runtimeConfig.public.logAnalyticsDelegated.clientId;
    const redirectUri = `${window.location.origin}${REDIRECT_PATH}`;
    const initializingClient = (async () => {
      const client: PublicClientApplication = new MsalClient({
        auth: {
          authority: ORGANIZATIONS_AUTHORITY,
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
    let popupClosed = false;
    status.value = "connecting";
    authorized.value = false;
    lastError.value = null;
    try {
      const client = await getClient();
      const { EventType } = await import("@azure/msal-browser");
      let closePoll: ReturnType<typeof setInterval> | null = null;
      const eventCallbackId = client.addEventCallback(
        (event) => {
          const popupWindow = getPopupWindowState(event.payload);
          if (!popupWindow) return;
          closePoll = setInterval(() => {
            if (!popupWindow.closed) return;
            popupClosed = true;
            if (closePoll !== null) {
              clearInterval(closePoll);
              closePoll = null;
            }
            if (generation === operationGeneration) {
              activeAccount = null;
              activeTenantId = null;
              connected.value = false;
              authorized.value = false;
              status.value = "idle";
            }
          }, POPUP_CLOSE_POLL_INTERVAL_MS);
        },
        [EventType.POPUP_OPENED],
      );
      let result;
      try {
        result = await client.loginPopup({
          authority: ORGANIZATIONS_AUTHORITY,
          overrideInteractionInProgress: true,
          prompt: "select_account",
          redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
          scopes: AZURE_MANAGEMENT_SCOPES,
        });
      } finally {
        if (closePoll !== null) clearInterval(closePoll);
        if (eventCallbackId !== null) client.removeEventCallback(eventCallbackId);
      }
      if (generation !== operationGeneration) {
        const newerConnectionUsesSameAccount =
          connected.value && activeAccount?.homeAccountId === result.account?.homeAccountId;
        if (!newerConnectionUsesSameAccount) {
          await client.clearCache({ account: result.account });
        }
        return null;
      }
      const tenantId = result.tenantId || result.account?.tenantId;
      if (!result.account || !tenantId || !isEntraId(tenantId)) {
        await client.clearCache({ account: result.account });
        throw new Error("Azure sign-in did not return a tenant.");
      }
      activeAccount = result.account;
      activeTenantId = tenantId;
      connected.value = true;
      status.value = "connected";
      return {
        accessToken: result.accessToken,
        tenantId,
        username: result.account.username,
      };
    } catch {
      if (generation !== operationGeneration) {
        return null;
      }
      if (popupClosed) {
        activeAccount = null;
        activeTenantId = null;
        connected.value = false;
        authorized.value = false;
        status.value = "idle";
        lastError.value = null;
        return null;
      }
      activeAccount = null;
      activeTenantId = null;
      connected.value = false;
      authorized.value = false;
      status.value = "error";
      lastError.value = "Azure authentication failed.";
      return null;
    }
  }

  async function getManagementAccessToken(tenantId: string, allowInteractive = true) {
    if (!activeAccount || !connected.value) {
      throw new Error("Connect to Azure before discovering available workspaces.");
    }
    const normalizedTenantId = tenantId.trim();
    if (!isEntraId(normalizedTenantId)) {
      throw new Error("Azure tenant is invalid.");
    }

    if (activeTenantId !== normalizedTenantId) {
      activeTenantId = normalizedTenantId;
      invalidateAuthorization();
    }
    const generation = operationGeneration;
    const authority = `https://login.microsoftonline.com/${encodeURIComponent(normalizedTenantId)}`;
    const client = await getClient();
    try {
      const result = await client.acquireTokenSilent({
        account: activeAccount,
        authority,
        scopes: AZURE_MANAGEMENT_SCOPES,
      });
      if (generation !== operationGeneration || activeTenantId !== normalizedTenantId) {
        throw new StaleTemporaryAuthOperation();
      }
      activeAccount = result.account ?? activeAccount;
      return result.accessToken;
    } catch (error: unknown) {
      if (
        error instanceof StaleTemporaryAuthOperation ||
        generation !== operationGeneration ||
        activeTenantId !== normalizedTenantId
      ) {
        throw new StaleTemporaryAuthOperation();
      }
      const { InteractionRequiredAuthError } = await import("@azure/msal-browser");
      if (!allowInteractive || !(error instanceof InteractionRequiredAuthError)) {
        throw new Error("Azure directory authentication failed.");
      }
      const result = await client.acquireTokenPopup({
        account: activeAccount,
        authority,
        redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
        scopes: AZURE_MANAGEMENT_SCOPES,
      });
      if (generation !== operationGeneration || activeTenantId !== normalizedTenantId) {
        throw new StaleTemporaryAuthOperation();
      }
      if (!result.account) {
        throw new Error("Azure directory authentication failed.");
      }
      activeAccount = result.account;
      return result.accessToken;
    }
  }

  async function acquireLogAnalyticsAccessToken(
    tenantId: string,
    allowInteractive: boolean,
    reportInteractionRequired: boolean,
  ) {
    if (!activeAccount || !connected.value) {
      throw new Error("Connect to Azure before running Log Analytics query.");
    }
    const normalizedTenantId = tenantId.trim();
    if (!isEntraId(normalizedTenantId) || activeTenantId !== normalizedTenantId) {
      throw new Error("Select an accessible Azure directory before running Log Analytics query.");
    }

    const generation = operationGeneration;
    const currentAuthorizationGeneration = authorizationGeneration;
    const assertCurrent = () => {
      if (
        generation !== operationGeneration ||
        currentAuthorizationGeneration !== authorizationGeneration ||
        activeTenantId !== normalizedTenantId
      ) {
        throw new StaleTemporaryAuthOperation();
      }
    };
    try {
      const client = await getClient();
      const result = await client.acquireTokenSilent({
        account: activeAccount,
        authority: `https://login.microsoftonline.com/${encodeURIComponent(normalizedTenantId)}`,
        scopes: LOG_ANALYTICS_SCOPES,
      });
      assertCurrent();
      activeAccount = result.account ?? activeAccount;
      authorized.value = true;
      lastError.value = null;
      return result.accessToken;
    } catch (error: unknown) {
      if (error instanceof StaleTemporaryAuthOperation || generation !== operationGeneration) {
        throw error;
      }
      assertCurrent();
      const { InteractionRequiredAuthError } = await import("@azure/msal-browser");
      if (allowInteractive && error instanceof InteractionRequiredAuthError) {
        try {
          const client = await getClient();
          const result = await client.acquireTokenPopup({
            account: activeAccount,
            authority: `https://login.microsoftonline.com/${encodeURIComponent(normalizedTenantId)}`,
            redirectUri: `${window.location.origin}${REDIRECT_PATH}`,
            scopes: LOG_ANALYTICS_SCOPES,
          });
          assertCurrent();
          activeAccount = result.account ?? activeAccount;
          authorized.value = true;
          lastError.value = null;
          return result.accessToken;
        } catch (popupError: unknown) {
          if (
            popupError instanceof StaleTemporaryAuthOperation ||
            generation !== operationGeneration
          ) {
            throw popupError;
          }
          authorized.value = false;
          lastError.value = "Log Analytics authorization failed. Try again.";
          throw new Error(lastError.value);
        }
      }

      if (error instanceof InteractionRequiredAuthError) {
        authorized.value = false;
        lastError.value = reportInteractionRequired
          ? "Log Analytics authorization expired. Authorize again."
          : null;
        return null;
      }

      activeAccount = null;
      activeTenantId = null;
      connected.value = false;
      authorized.value = false;
      status.value = "error";
      lastError.value =
        error instanceof InteractionRequiredAuthError
          ? "Azure authentication expired. Connect again."
          : "Azure token acquisition failed. Connect again.";
      throw new Error(lastError.value);
    }
  }

  async function checkAuthorization(tenantId: string) {
    invalidateAuthorization();
    try {
      return (await acquireLogAnalyticsAccessToken(tenantId, false, false)) !== null;
    } catch (error: unknown) {
      if (error instanceof StaleTemporaryAuthOperation) return false;
      return false;
    }
  }

  async function getAccessToken(tenantId: string, allowInteractive = false) {
    const accessToken = await acquireLogAnalyticsAccessToken(tenantId, allowInteractive, true);
    if (accessToken === null) {
      throw new Error(
        lastError.value ?? "Grant Log Analytics query permission before running a query.",
      );
    }
    return accessToken;
  }

  async function disconnect() {
    const account = activeAccount;
    operationGeneration += 1;
    activeAccount = null;
    activeTenantId = null;
    connected.value = false;
    invalidateAuthorization();
    status.value = "idle";

    if (clientPromise !== null) {
      const client = await clientPromise;
      await client.clearCache(account ? { account } : undefined);
    }
    clientPromise = null;
  }

  onScopeDispose(() => {
    void disconnect();
  });

  return {
    authorized,
    checkAuthorization,
    connect,
    connected,
    disconnect,
    getAccessToken,
    getManagementAccessToken,
    invalidateAuthorization,
    lastError,
    status,
  };
}
