import { LOG_ANALYSIS_ROLE } from "../../shared/types/logAnalytics";

const TOKEN_SCOPE = "https://api.loganalytics.io/.default";
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const DEFAULT_TOKEN_TIMEOUT_MS = 15_000;

export interface LogAnalyticsRuntimeConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
}

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
  tenantId: string;
  clientId: string;
}

interface PendingAccessToken {
  clientId: string;
  promise: Promise<CachedAccessToken>;
  tenantId: string;
}

export type LogAnalyticsTokenErrorKind = "authorization" | "throttled" | "upstream";

export class LogAnalyticsTokenError extends Error {
  readonly kind: LogAnalyticsTokenErrorKind;
  readonly retryAfterSeconds?: number;

  constructor(kind: LogAnalyticsTokenErrorKind, retryAfterSeconds?: number) {
    super("Log Analytics token acquisition failed");
    this.name = "LogAnalyticsTokenError";
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class LogAnalyticsConfigurationError extends Error {
  constructor() {
    super("Log Analytics server configuration is incomplete");
    this.name = "LogAnalyticsConfigurationError";
  }
}

export class LogAnalyticsSessionAuthorizationError extends Error {
  constructor() {
    super("Log Analytics access is forbidden");
    this.name = "LogAnalyticsSessionAuthorizationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRequiredConfigValue(source: Record<string, unknown>, key: string) {
  const value = source[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new LogAnalyticsConfigurationError();
  }

  return value.trim();
}

function readRetryAfterSeconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (value === null) {
    return undefined;
  }

  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

function tokenErrorForStatus(response: Response) {
  if (response.status === 401 || response.status === 403 || response.status === 400) {
    return new LogAnalyticsTokenError("authorization");
  }
  if (response.status === 429) {
    return new LogAnalyticsTokenError("throttled", readRetryAfterSeconds(response));
  }

  return new LogAnalyticsTokenError("upstream");
}

export function parseLogAnalyticsRuntimeConfig(value: unknown): LogAnalyticsRuntimeConfig {
  if (!isRecord(value)) {
    throw new LogAnalyticsConfigurationError();
  }

  return {
    tenantId: readRequiredConfigValue(value, "tenantId"),
    clientId: readRequiredConfigValue(value, "clientId"),
    clientSecret: readRequiredConfigValue(value, "clientSecret"),
    workspaceId: readRequiredConfigValue(value, "workspaceId"),
  };
}

export function isLogAnalyticsSessionAuthorized(session: unknown, tenantId: string) {
  if (!isRecord(session) || session.provider !== "entra" || !isRecord(session.claims)) {
    return false;
  }

  const claimTenantId = session.claims.tid;
  const roles = session.claims.roles;
  return (
    typeof claimTenantId === "string" &&
    claimTenantId.toLowerCase() === tenantId.toLowerCase() &&
    Array.isArray(roles) &&
    roles.some((role) => role === LOG_ANALYSIS_ROLE)
  );
}

export function assertLogAnalyticsSessionAuthorized(session: unknown, tenantId: string) {
  if (!isLogAnalyticsSessionAuthorized(session, tenantId)) {
    throw new LogAnalyticsSessionAuthorizationError();
  }
}

export function parseAuthorizedLogAnalyticsRuntimeConfig(
  session: unknown,
  value: unknown,
): LogAnalyticsRuntimeConfig {
  if (!isRecord(value)) {
    throw new LogAnalyticsConfigurationError();
  }

  const tenantId = readRequiredConfigValue(value, "tenantId");
  assertLogAnalyticsSessionAuthorized(session, tenantId);
  return parseLogAnalyticsRuntimeConfig(value);
}

function waitForAccessToken(
  promise: Promise<CachedAccessToken>,
  signal?: AbortSignal,
): Promise<CachedAccessToken> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }

  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(
      (token) => {
        signal.removeEventListener("abort", abort);
        resolve(token);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

export function createLogAnalyticsTokenProvider(
  fetchImplementation: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
  timeoutMs = DEFAULT_TOKEN_TIMEOUT_MS,
) {
  let cached: CachedAccessToken | undefined;
  let pending: PendingAccessToken | undefined;

  async function requestAccessToken(config: LogAnalyticsRuntimeConfig) {
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
    const body = new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "client_credentials",
      scope: TOKEN_SCOPE,
    });

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<Response>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort();
        reject(new LogAnalyticsTokenError("upstream"));
      }, timeoutMs);
    });

    let response: Response;
    try {
      response = await Promise.race([
        fetchImplementation(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);
    } catch (error: unknown) {
      if (error instanceof LogAnalyticsTokenError) {
        throw error;
      }
      throw new LogAnalyticsTokenError("upstream");
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      throw tokenErrorForStatus(response);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new LogAnalyticsTokenError("upstream");
    }

    if (!isRecord(payload) || typeof payload.access_token !== "string") {
      throw new LogAnalyticsTokenError("upstream");
    }

    const expiresIn = Number(payload.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw new LogAnalyticsTokenError("upstream");
    }

    return {
      accessToken: payload.access_token,
      expiresAt: now() + expiresIn * 1000,
      tenantId: config.tenantId,
      clientId: config.clientId,
    } satisfies CachedAccessToken;
  }

  return async function getAccessToken(config: LogAnalyticsRuntimeConfig, signal?: AbortSignal) {
    const currentTime = now();
    if (
      cached &&
      cached.tenantId === config.tenantId &&
      cached.clientId === config.clientId &&
      cached.expiresAt - TOKEN_EXPIRY_SKEW_MS > currentTime
    ) {
      return cached.accessToken;
    }

    if (!pending || pending.tenantId !== config.tenantId || pending.clientId !== config.clientId) {
      const current: PendingAccessToken = {
        clientId: config.clientId,
        promise: requestAccessToken(config),
        tenantId: config.tenantId,
      };
      pending = current;
      void current.promise
        .then((token) => {
          cached = token;
        })
        .finally(() => {
          if (pending === current) {
            pending = undefined;
          }
        })
        .catch(() => undefined);
    }

    const token = await waitForAccessToken(pending.promise, signal);
    return token.accessToken;
  };
}

export const getLogAnalyticsAccessToken = createLogAnalyticsTokenProvider();
