import type {
  DeploymentCapabilities,
  DeploymentConfigurationError,
  DeploymentConfigurationErrorCode,
} from "../../shared/types/deploymentCapabilities";

interface DeploymentEnvironment {
  [key: string]: string | undefined;
  NUXT_OIDC_AUTH_SESSION_SECRET?: string;
  NUXT_OIDC_SESSION_SECRET?: string;
  NUXT_OIDC_TOKEN_KEY?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }

  const nested = value[key];
  return isRecord(nested) ? nested : {};
}

function readValue(source: Record<string, unknown>, key: string) {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
}

function hasAny(values: string[]) {
  return values.some((value) => value.length > 0);
}

function hasAll(values: string[]) {
  return values.every((value) => value.length > 0);
}

function addError(
  errors: DeploymentConfigurationError[],
  code: DeploymentConfigurationErrorCode,
  message: string,
) {
  errors.push({ code, message });
}

function parseConnectionString(connectionString: string) {
  const values = new Map<string, string>();
  for (const part of connectionString.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim().toLowerCase();
    const value = part.slice(separatorIndex + 1).trim();
    if (key && value) {
      values.set(key, value);
    }
  }
  return values;
}

function isValidEventHubConnection(connectionString: string, eventHubName: string) {
  const values = parseConnectionString(connectionString);
  const endpoint = values.get("endpoint");
  if (!endpoint || !values.has("sharedaccesskeyname") || !values.has("sharedaccesskey")) {
    return false;
  }

  try {
    if (new URL(endpoint).protocol !== "sb:") {
      return false;
    }
  } catch {
    return false;
  }

  return Boolean(values.get("entitypath") || eventHubName);
}

function isValidUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1"))
    );
  } catch {
    return false;
  }
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
}

function isValidTokenKey(value: string) {
  try {
    return Buffer.from(value, "base64").byteLength === 32;
  } catch {
    return false;
  }
}

export function parseDeploymentCapabilities(
  runtimeConfig: unknown,
  environment: DeploymentEnvironment = process.env,
): DeploymentCapabilities {
  const root = isRecord(runtimeConfig) ? runtimeConfig : {};
  const eventHub = readRecord(root, "eventHub");
  const logAnalytics = readRecord(root, "logAnalytics");
  const oidc = readRecord(root, "oidc");
  const entra = readRecord(readRecord(oidc, "providers"), "entra");
  const delegated = readRecord(readRecord(root, "public"), "logAnalyticsDelegated");
  const errors: DeploymentConfigurationError[] = [];

  const eventHubConnectionString = readValue(eventHub, "connectionString");
  const eventHubName = readValue(eventHub, "name");
  const eventHubValues = [eventHubConnectionString, eventHubName];
  const eventHubIntent = hasAny(eventHubValues);
  let eventHubAvailable = false;
  if (eventHubIntent) {
    if (!eventHubConnectionString) {
      addError(errors, "event_hub_incomplete", "Event Hub configuration is incomplete");
    } else if (!isValidEventHubConnection(eventHubConnectionString, eventHubName)) {
      addError(errors, "event_hub_invalid", "Event Hub configuration is invalid");
    } else {
      eventHubAvailable = true;
    }
  }

  const logAnalyticsValues = ["tenantId", "clientId", "clientSecret", "workspaceId"].map((key) =>
    readValue(logAnalytics, key),
  );
  const logAnalyticsIntent = hasAny(logAnalyticsValues);
  let predefinedLogAnalyticsAvailable = false;
  if (logAnalyticsIntent) {
    if (!hasAll(logAnalyticsValues)) {
      addError(errors, "log_analytics_incomplete", "Log Analytics configuration is incomplete");
    } else if (
      ![logAnalyticsValues[0], logAnalyticsValues[1], logAnalyticsValues[3]].every(
        (value) => typeof value === "string" && isUuid(value),
      )
    ) {
      addError(errors, "log_analytics_invalid", "Log Analytics configuration is invalid");
    } else {
      predefinedLogAnalyticsAvailable = true;
    }
  }

  const delegatedValues = [readValue(delegated, "tenantId"), readValue(delegated, "clientId")];
  const delegatedIntent = hasAny(delegatedValues);
  let temporaryLogAnalyticsAuthAvailable = false;
  if (delegatedIntent) {
    if (!hasAll(delegatedValues)) {
      addError(
        errors,
        "delegated_log_analytics_incomplete",
        "Delegated Log Analytics configuration is incomplete",
      );
    } else if (!delegatedValues.every(isUuid)) {
      addError(
        errors,
        "delegated_log_analytics_invalid",
        "Delegated Log Analytics configuration is invalid",
      );
    } else {
      temporaryLogAnalyticsAuthAvailable = true;
    }
  }

  const managedIntent = eventHubIntent || logAnalyticsIntent;
  if (managedIntent) {
    const oidcConfig = {
      clientId: readValue(entra, "clientId"),
      clientSecret: readValue(entra, "clientSecret"),
      redirectUri: readValue(entra, "redirectUri"),
      authorizationUrl: readValue(entra, "authorizationUrl"),
      tokenUrl: readValue(entra, "tokenUrl"),
      sessionSecret: environment.NUXT_OIDC_SESSION_SECRET?.trim() ?? "",
      authSessionSecret: environment.NUXT_OIDC_AUTH_SESSION_SECRET?.trim() ?? "",
      tokenKey: environment.NUXT_OIDC_TOKEN_KEY?.trim() ?? "",
    };
    const oidcValues = Object.values(oidcConfig);
    if (!hasAll(oidcValues)) {
      addError(errors, "oidc_incomplete", "Application login configuration is incomplete");
    } else if (
      !isValidUrl(oidcConfig.redirectUri) ||
      !isValidUrl(oidcConfig.authorizationUrl) ||
      !isValidUrl(oidcConfig.tokenUrl) ||
      !isUuid(oidcConfig.clientId) ||
      oidcConfig.sessionSecret.length < 48 ||
      oidcConfig.authSessionSecret.length < 32 ||
      !isValidTokenKey(oidcConfig.tokenKey)
    ) {
      addError(errors, "oidc_invalid", "Application login configuration is invalid");
    }
  }

  const mode = errors.length > 0 ? "invalid" : managedIntent ? "managed" : "anonymous";
  if (mode === "invalid") {
    eventHubAvailable = false;
    temporaryLogAnalyticsAuthAvailable = false;
  }

  return {
    mode,
    eventHubAvailable,
    predefinedLogAnalyticsAvailable: mode === "managed" && predefinedLogAnalyticsAvailable,
    temporaryLogAnalyticsAuthAvailable: mode === "anonymous" && temporaryLogAnalyticsAuthAvailable,
    errors,
  };
}
