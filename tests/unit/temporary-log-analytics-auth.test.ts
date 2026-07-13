import { ref, type Ref } from "vue";

const msal = vi.hoisted(() => {
  const clearCache = vi.fn();
  const initialize = vi.fn();
  const loginPopup = vi.fn();
  const acquireTokenPopup = vi.fn();
  const acquireTokenSilent = vi.fn();
  const constructor = vi.fn(function () {
    return { acquireTokenPopup, acquireTokenSilent, clearCache, initialize, loginPopup };
  });

  return { acquireTokenPopup, acquireTokenSilent, clearCache, constructor, initialize, loginPopup };
});

const MockInteractionRequiredAuthError = vi.hoisted(() => class extends Error {});

vi.mock("@azure/msal-browser", () => ({
  BrowserCacheLocation: { MemoryStorage: "MemoryStorage" },
  InteractionRequiredAuthError: MockInteractionRequiredAuthError,
  PublicClientApplication: msal.constructor,
}));

const account = { homeAccountId: "temporary-user" };
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
  msal.acquireTokenSilent.mockReset();
  msal.acquireTokenPopup.mockReset();
  msal.clearCache.mockReset().mockResolvedValue(undefined);
  msal.constructor.mockClear();
  msal.initialize.mockReset().mockResolvedValue(undefined);
  msal.loginPopup.mockReset().mockResolvedValue({ account });

  vi.stubGlobal("window", { location: { origin: "https://argus.example.com" } });
  vi.stubGlobal("useRuntimeConfig", () => ({
    public: {
      logAnalyticsDelegated: {
        clientId: "11111111-1111-4111-8111-111111111111",
        tenantId: "22222222-2222-4222-8222-222222222222",
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
  vi.unstubAllGlobals();
});

describe("temporary Log Analytics authentication", () => {
  it("connects with popup PKCE configuration backed by MSAL memory storage", async () => {
    const auth = await createAuth();

    await expect(auth.connect()).resolves.toBe(true);

    expect(msal.constructor).toHaveBeenCalledWith(
      expect.objectContaining({
        auth: expect.objectContaining({
          clientId: "11111111-1111-4111-8111-111111111111",
          redirectUri: "https://argus.example.com/log-analytics-redirect.html",
        }),
        cache: { cacheLocation: "MemoryStorage" },
      }),
    );
    expect(msal.loginPopup).toHaveBeenCalledWith({
      redirectUri: "https://argus.example.com/log-analytics-redirect.html",
      scopes: ["https://api.loganalytics.io/Data.Read"],
    });
    expect(auth.connected.value).toBe(true);
    expect(auth.status.value).toBe("connected");
  });

  it("returns a silently renewed token without copying it into Nuxt state", async () => {
    const token = "delegated-access-token";
    msal.loginPopup.mockResolvedValue({ account, accessToken: "login-popup-token" });
    msal.acquireTokenSilent.mockResolvedValue({ accessToken: token });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken()).resolves.toBe(token);

    expect(msal.acquireTokenSilent).toHaveBeenCalledWith({
      account,
      scopes: ["https://api.loganalytics.io/Data.Read"],
    });
    expect(await auth.getAccessToken()).toBe(token);
    expect(msal.acquireTokenSilent).toHaveBeenCalledTimes(2);
    expect([...state.entries()]).toEqual([
      ["temporary-log-analytics-connected", expect.objectContaining({ value: true })],
      ["temporary-log-analytics-status", expect.objectContaining({ value: "connected" })],
      ["temporary-log-analytics-error", expect.objectContaining({ value: null })],
    ]);
    expect(JSON.stringify([...state.values()].map((value) => value.value))).not.toContain(token);
  });

  it("uses popup fallback only for an explicitly interactive token request", async () => {
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    msal.acquireTokenPopup.mockResolvedValue({ accessToken: "popup-token" });
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken(true)).resolves.toBe("popup-token");
    expect(msal.acquireTokenPopup).toHaveBeenCalledOnce();
  });

  it("can retry after MSAL initialization fails", async () => {
    msal.initialize.mockRejectedValueOnce(new Error("initialization failed"));
    const auth = await createAuth();

    await expect(auth.connect()).resolves.toBe(false);
    await expect(auth.connect()).resolves.toBe(true);

    expect(msal.constructor).toHaveBeenCalledTimes(2);
    expect(auth.connected.value).toBe(true);
  });

  it("disconnects local authentication when interactive token acquisition fails", async () => {
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    msal.acquireTokenPopup.mockRejectedValue(new Error("popup closed"));
    const auth = await createAuth();
    await auth.connect();

    await expect(auth.getAccessToken(true)).rejects.toThrow(
      "Azure token acquisition failed. Connect again.",
    );
    expect(auth.connected.value).toBe(false);
    expect(auth.status.value).toBe("error");
  });

  it("clears only the temporary account and local state on disconnect", async () => {
    const auth = await createAuth();
    await auth.connect();

    await auth.disconnect();

    expect(msal.clearCache).toHaveBeenCalledWith({ account });
    expect(auth.connected.value).toBe(false);
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
    const popup = createDeferred<{ account: typeof account; accessToken: string }>();
    msal.loginPopup.mockReturnValue(popup.promise);
    const auth = await createAuth();

    const connecting = auth.connect();
    await vi.waitFor(() => expect(msal.loginPopup).toHaveBeenCalledOnce());
    await auth.disconnect();
    popup.resolve({ account, accessToken: "late-token" });

    await expect(connecting).resolves.toBe(false);
    expect(auth.connected.value).toBe(false);
    expect(msal.clearCache).toHaveBeenLastCalledWith({ account });
  });

  it("does not retain popup token when query preparation resolves after disconnect", async () => {
    const popup = createDeferred<{ account: typeof account; accessToken: string }>();
    msal.acquireTokenSilent.mockRejectedValue(new MockInteractionRequiredAuthError());
    msal.acquireTokenPopup.mockReturnValue(popup.promise);
    const auth = await createAuth();
    await auth.connect();

    const preparing = auth.getAccessToken(true);
    await vi.waitFor(() => expect(msal.acquireTokenPopup).toHaveBeenCalledOnce());
    await auth.disconnect();
    popup.resolve({ account, accessToken: "late-token" });

    await expect(preparing).rejects.toThrow();
    expect(auth.connected.value).toBe(false);
    await expect(auth.getAccessToken()).rejects.toThrow(
      "Connect to Azure before running Log Analytics query.",
    );
  });
});
