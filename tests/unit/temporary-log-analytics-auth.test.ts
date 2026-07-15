import { ref, type Ref } from "vue";

const msal = vi.hoisted(() => {
  type AuthEvent = { eventType: string; payload: unknown };
  const eventCallbacks = new Set<(event: AuthEvent) => void>();
  const addEventCallback = vi.fn<(callback: (event: AuthEvent) => void) => string>((callback) => {
    eventCallbacks.add(callback);
    return "temporary-auth-event-callback";
  });
  const clearCache = vi.fn();
  const initialize = vi.fn();
  const loginPopup = vi.fn();
  const acquireTokenPopup = vi.fn();
  const acquireTokenSilent = vi.fn();
  const removeEventCallback = vi.fn<(callbackId: string) => void>(() => eventCallbacks.clear());
  const constructor = vi.fn(function () {
    return {
      acquireTokenPopup,
      acquireTokenSilent,
      addEventCallback,
      clearCache,
      initialize,
      loginPopup,
      removeEventCallback,
    };
  });

  return {
    acquireTokenPopup,
    acquireTokenSilent,
    addEventCallback,
    clearCache,
    constructor,
    emitEvent(event: AuthEvent) {
      for (const callback of eventCallbacks) callback(event);
    },
    eventCallbacks,
    initialize,
    loginPopup,
    removeEventCallback,
  };
});

const MockInteractionRequiredAuthError = vi.hoisted(() => class extends Error {});

vi.mock("@azure/msal-browser", () => ({
  BrowserCacheLocation: { MemoryStorage: "MemoryStorage" },
  EventType: { POPUP_OPENED: "msal:popupOpened" },
  InteractionRequiredAuthError: MockInteractionRequiredAuthError,
  PublicClientApplication: msal.constructor,
}));

const tenantId = "22222222-2222-4222-8222-222222222222";
const account = {
  homeAccountId: "temporary-user",
  tenantId,
  username: "user@example.com",
};
let state: Map<string, Ref<unknown>>;
let dispose: (() => void | Promise<void>) | undefined;

async function createAuth() {
  vi.resetModules();
  const { useTemporaryLogAnalyticsAuth } =
    await import("../../app/composables/useTemporaryLogAnalyticsAuth");
  return useTemporaryLogAnalyticsAuth();
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  state = new Map();
  dispose = undefined;
  msal.addEventCallback.mockClear();
  msal.acquireTokenSilent.mockReset();
  msal.acquireTokenPopup.mockReset();
  msal.clearCache.mockReset().mockResolvedValue(undefined);
  msal.constructor.mockClear();
  msal.initialize.mockReset().mockResolvedValue(undefined);
  msal.loginPopup.mockReset().mockResolvedValue({
    accessToken: "management-login-token",
    account,
    tenantId,
  });
  msal.eventCallbacks.clear();
  msal.removeEventCallback.mockClear();

  vi.stubGlobal("window", { location: { origin: "https://argus.example.com" } });
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: {
      logAnalyticsDelegated: {
        clientId: "11111111-1111-4111-8111-111111111111",
      },
    },
  }));
  vi.stubGlobal("useState", <T>(key: string, initialize: () => T) => {
    if (!state.has(key)) {
      state.set(key, ref(initialize()));
    }
    return state.get(key) as Ref<T>;
  });
  vi.stubGlobal("onScopeDispose", (callback: () => void | Promise<void>) => {
    dispose = callback;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("temporary Log Analytics authentication", () => {
  it("rejects a sign-in result without a valid tenant", async () => {
    msal.loginPopup.mockResolvedValue({ account: { ...account, tenantId: "" } });
    const auth = await createAuth();

    await expect(auth.connect()).resolves.toBeNull();

    expect(msal.clearCache).toHaveBeenCalled();
    expect(auth.status.value).toBe("error");
    expect(auth.lastError.value).toBe("Azure authentication failed.");
  });

  it("derives tenant from organization login backed by MSAL memory storage", async () => {
    const auth = await createAuth();

    await expect(auth.connect()).resolves.toEqual({
      accessToken: "management-login-token",
      tenantId,
      username: "user@example.com",
    });

    expect(msal.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          clientId: "11111111-1111-4111-8111-111111111111",
          authority: "https://login.microsoftonline.com/organizations",
          redirectUri: "https://argus.example.com/log-analytics-redirect.html",
        }),
        cache: { cacheLocation: "MemoryStorage" },
      }),
    );
    expect(msal.loginPopup).toHaveBeenCalledWith({
      authority: "https://login.microsoftonline.com/organizations",
      overrideInteractionInProgress: true,
      prompt: "select_account",
      redirectUri: "https://argus.example.com/log-analytics-redirect.html",
      scopes: ["https://management.azure.com/user_impersonation"],
    });
    expect(auth.connected.value).toBe(true);
    expect(auth.status.value).toBe("connected");
  });

  it("accepts a sign-in result delivered after the popup closes", async () => {
    vi.useFakeTimers();
    const popup = createDeferred<{
      account: typeof account;
      accessToken: string;
      tenantId: string;
    }>();
    msal.loginPopup.mockReturnValueOnce(popup.promise);
    const auth = await createAuth();

    const connection = auth.connect();
    await vi.waitFor(() => expect(msal.loginPopup).toHaveBeenCalledOnce());
    const popupWindow = { closed: false };
    msal.emitEvent({ eventType: "msal:popupOpened", payload: { popupWindow } });
    popupWindow.closed = true;
    await vi.advanceTimersByTimeAsync(500);

    expect(auth.status.value).toBe("idle");
    expect(auth.lastError.value).toBeNull();
    popup.resolve({ account, accessToken: "management-login-token", tenantId });
    await expect(connection).resolves.toEqual({
      accessToken: "management-login-token",
      tenantId,
      username: "user@example.com",
    });
    expect(auth.status.value).toBe("connected");
    expect(msal.removeEventCallback).toHaveBeenCalledWith("temporary-auth-event-callback");
    expect(msal.eventCallbacks.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("allows retry while a closed popup is still awaiting its bridge timeout", async () => {
    vi.useFakeTimers();
    const firstPopup = createDeferred<{
      account: typeof account;
      accessToken: string;
      tenantId: string;
    }>();
    msal.loginPopup.mockReturnValueOnce(firstPopup.promise).mockResolvedValueOnce({
      accessToken: "retried-management-token",
      account,
      tenantId,
    });
    const auth = await createAuth();

    const firstConnection = auth.connect();
    await vi.waitFor(() => expect(msal.loginPopup).toHaveBeenCalledOnce());
    const popupWindow = { closed: false };
    msal.emitEvent({ eventType: "msal:popupOpened", payload: { popupWindow } });
    popupWindow.closed = true;
    await vi.advanceTimersByTimeAsync(500);

    expect(auth.status.value).toBe("idle");
    const retriedConnection = auth.connect();
    await expect(retriedConnection).resolves.toEqual({
      accessToken: "retried-management-token",
      tenantId,
      username: "user@example.com",
    });
    expect(msal.loginPopup).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ overrideInteractionInProgress: true }),
    );

    firstPopup.resolve({ account, accessToken: "late-token", tenantId });
    await expect(firstConnection).resolves.toBeNull();
    expect(auth.status.value).toBe("connected");
    expect(auth.connected.value).toBe(true);
    expect(msal.clearCache).not.toHaveBeenCalled();
  });

  it("returns a silently renewed token without copying it into Nuxt state", async () => {
    const token = "delegated-access-token";
    msal.acquireTokenSilent.mockResolvedValue({ accessToken: token, account });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken(tenantId)).resolves.toBe(token);

    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      account,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      scopes: ["https://api.loganalytics.io/Data.Read"],
    });
    expect(await auth.getAccessToken(tenantId)).toBe(token);
    expect(msal.acquireTokenSilent).toHaveBeenCalledTimes(2);
    expect([...state.entries()]).toEqual([
      ["temporary-log-analytics-connected", expect.objectContaining({ value: true })],
      ["temporary-log-analytics-status", expect.objectContaining({ value: "connected" })],
      ["temporary-log-analytics-authorized", expect.objectContaining({ value: true })],
      ["temporary-log-analytics-error", expect.objectContaining({ value: null })],
    ]);
    expect(JSON.stringify(Array.from(state.values(), (value) => value.value))).not.toContain(token);
  });

  it("detects cached Log Analytics permission silently", async () => {
    msal.acquireTokenSilent.mockResolvedValue({ accessToken: "cached-token", account });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.checkAuthorization(tenantId)).resolves.toBe(true);

    expect(auth.authorized.value).toBe(true);
    expect(auth.lastError.value).toBeNull();
    expect(msal.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("leaves interactive authorization available when silent permission is required", async () => {
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.checkAuthorization(tenantId)).resolves.toBe(false);

    expect(auth.authorized.value).toBe(false);
    expect(auth.lastError.value).toBeNull();
    expect(msal.acquireTokenPopup).not.toHaveBeenCalled();
  });

  it("acquires Azure Resource Manager token separately for selected directory", async () => {
    const selectedTenantId = "33333333-3333-4333-8333-333333333333";
    const selectedTenantAccount = { ...account, tenantId: selectedTenantId };
    msal.acquireTokenSilent.mockResolvedValue({
      accessToken: "management-token",
      account: selectedTenantAccount,
      tenantId: selectedTenantId,
    });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getManagementAccessToken(selectedTenantId)).resolves.toBe("management-token");

    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      account,
      authority: `https://login.microsoftonline.com/${selectedTenantId}`,
      scopes: ["https://management.azure.com/user_impersonation"],
    });
    expect(msal.acquireTokenSilent).not.toHaveBeenCalledWith(
      expect.objectContaining({
        scopes: expect.arrayContaining(["https://api.loganalytics.io/Data.Read"]),
      }),
    );
  });

  it("does not use an Azure Resource Manager token issued for previous directory", async () => {
    const selectedTenantId = "33333333-3333-4333-8333-333333333333";
    const selectedTenantAccount = { ...account, tenantId: selectedTenantId };
    msal.acquireTokenSilent.mockResolvedValue({
      accessToken: "initial-tenant-token",
      account,
      tenantId,
    });
    msal.acquireTokenPopup.mockResolvedValue({
      accessToken: "selected-tenant-token",
      account: selectedTenantAccount,
      tenantId: selectedTenantId,
    });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getManagementAccessToken(selectedTenantId)).resolves.toBe(
      "selected-tenant-token",
    );
    expect(msal.acquireTokenPopup).toHaveBeenCalledWith(
      expect.objectContaining({
        authority: `https://login.microsoftonline.com/${selectedTenantId}`,
        scopes: ["https://management.azure.com/user_impersonation"],
      }),
    );
  });

  it("ignores a stale directory token result after a newer directory is selected", async () => {
    const firstTenantId = "33333333-3333-4333-8333-333333333333";
    const secondTenantId = "44444444-4444-4444-8444-444444444444";
    const first = createDeferred<{ accessToken: string; account: typeof account }>();
    const second = createDeferred<{ accessToken: string; account: typeof account }>();
    msal.acquireTokenSilent.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const auth = await createAuth();
    await auth.connect();

    const firstRequest = auth.getManagementAccessToken(firstTenantId);
    const secondRequest = auth.getManagementAccessToken(secondTenantId);
    second.resolve({
      accessToken: "second-token",
      account: { ...account, tenantId: secondTenantId },
    });
    await expect(secondRequest).resolves.toBe("second-token");
    first.resolve({ accessToken: "first-token", account: { ...account, tenantId: firstTenantId } });
    await expect(firstRequest).rejects.toBeInstanceOf(Error);

    msal.acquireTokenSilent.mockResolvedValue({
      accessToken: "query-token",
      account: { ...account, tenantId: secondTenantId },
    });
    await expect(auth.getAccessToken(secondTenantId)).resolves.toBe("query-token");
    expect(msal.acquireTokenSilent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        authority: `https://login.microsoftonline.com/${secondTenantId}`,
      }),
    );
  });

  it("uses popup fallback only for an explicitly interactive token request", async () => {
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    msal.acquireTokenPopup.mockResolvedValue({ accessToken: "popup-token" });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken(tenantId, true)).resolves.toBe("popup-token");
    expect(msal.acquireTokenPopup).toHaveBeenCalledOnce();
    expect(auth.authorized.value).toBe(true);
  });

  it("invalidates Log Analytics authorization when switching directory", async () => {
    const selectedTenantId = "33333333-3333-4333-8333-333333333333";
    msal.acquireTokenSilent.mockResolvedValue({
      accessToken: "token",
      account: { ...account, tenantId: selectedTenantId },
      tenantId: selectedTenantId,
    });
    const auth = await createAuth();
    await auth.connect();
    await auth.getAccessToken(tenantId);
    expect(auth.authorized.value).toBe(true);

    await auth.getManagementAccessToken(selectedTenantId);

    expect(auth.authorized.value).toBe(false);
  });

  it("can retry after MSAL initialization fails", async () => {
    msal.initialize.mockRejectedValueOnce(new Error("initialization failed"));
    const auth = await createAuth();

    await expect(auth.connect()).resolves.toBeNull();
    await expect(auth.connect()).resolves.toEqual(expect.objectContaining({ tenantId }));

    expect(msal.constructor).toHaveBeenCalledTimes(2);
    expect(auth.connected.value).toBe(true);
  });

  it("preserves Azure connection when interactive Log Analytics authorization fails", async () => {
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    msal.acquireTokenPopup.mockRejectedValue(new Error("popup closed"));
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken(tenantId, true)).rejects.toThrow(
      "Log Analytics authorization failed. Try again.",
    );
    expect(auth.connected.value).toBe(true);
    expect(auth.authorized.value).toBe(false);
    expect(auth.status.value).toBe("connected");
  });

  it("does not open a popup for a non-interactive query token request", async () => {
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken(tenantId, false)).rejects.toThrow(
      "Log Analytics authorization expired. Authorize again.",
    );
    expect(msal.acquireTokenPopup).not.toHaveBeenCalled();
    expect(auth.connected.value).toBe(true);
    expect(auth.authorized.value).toBe(false);
  });

  it("clears only the temporary account and local state on disconnect", async () => {
    msal.acquireTokenSilent.mockResolvedValue({ accessToken: "delegated-access-token", account });
    const auth = await createAuth();
    await auth.connect();
    await auth.getAccessToken(tenantId);

    await auth.disconnect();

    expect(msal.clearCache).toHaveBeenCalledWith({ account });
    expect(auth.connected.value).toBe(false);
    expect(auth.authorized.value).toBe(false);
    expect(auth.status.value).toBe("idle");
    expect(auth.lastError.value).toBeNull();
  });

  it("clears temporary authentication when its owning scope is disposed", async () => {
    const auth = await createAuth();
    await auth.connect();

    await dispose?.();

    expect(msal.clearCache).toHaveBeenCalledWith({ account });
    expect(auth.connected.value).toBe(false);
  });

  it("does not restore authentication when popup resolves after disconnect", async () => {
    const popup = createDeferred<{
      account: typeof account;
      accessToken: string;
      tenantId: string;
    }>();
    msal.loginPopup.mockReturnValue(popup.promise);
    const auth = await createAuth();

    const connecting = auth.connect();
    await vi.waitFor(() => expect(msal.loginPopup).toHaveBeenCalledOnce());
    await auth.disconnect();
    popup.resolve({ account, accessToken: "late-token", tenantId });

    await expect(connecting).resolves.toBeNull();
    expect(auth.connected.value).toBe(false);
    expect(msal.clearCache).toHaveBeenLastCalledWith({ account });
  });

  it("does not retain popup token when query preparation resolves after disconnect", async () => {
    const popup = createDeferred<{ account: typeof account; accessToken: string }>();
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    msal.acquireTokenPopup.mockReturnValue(popup.promise);
    const auth = await createAuth();
    await auth.connect();

    const preparing = auth.getAccessToken(tenantId, true);
    await vi.waitFor(() => expect(msal.acquireTokenPopup).toHaveBeenCalledOnce());
    await auth.disconnect();
    popup.resolve({ account, accessToken: "late-token" });

    await expect(preparing).rejects.toBeInstanceOf(Error);
    expect(auth.connected.value).toBe(false);
    await expect(auth.getAccessToken(tenantId)).rejects.toThrow(
      "Connect to Azure before running Log Analytics query.",
    );
  });

  it("does not restore authorization when a silent check resolves after disconnect", async () => {
    const token = createDeferred<{ account: typeof account; accessToken: string }>();
    msal.acquireTokenSilent.mockReturnValue(token.promise);
    const auth = await createAuth();
    await auth.connect();

    const checking = auth.checkAuthorization(tenantId);
    await vi.waitFor(() => expect(msal.acquireTokenSilent).toHaveBeenCalledOnce());
    await auth.disconnect();
    token.resolve({ account, accessToken: "late-token" });

    await expect(checking).resolves.toBe(false);
    expect(auth.authorized.value).toBe(false);
  });
});
