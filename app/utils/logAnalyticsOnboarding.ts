const LOG_ANALYTICS_ADMIN_CONSENT_SCOPE = "https://api.loganalytics.io/.default";
const REDIRECT_PATH = "/log-analytics-redirect.html";
const ENTRA_ID_PATTERN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export const LOG_ANALYTICS_ADMIN_CONSENT_STATE = "azure-argus-admin-consent";

export const LOG_ANALYTICS_WORKSPACES_URL =
  "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.OperationalInsights%2Fworkspaces";

export function isEntraId(value: string) {
  return ENTRA_ID_PATTERN.test(value.trim());
}

export function createLogAnalyticsAdminConsentUrl(
  tenantId: string,
  clientId: string,
  origin: string,
) {
  if (!isEntraId(tenantId) || !isEntraId(clientId)) {
    return null;
  }

  const url = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId.trim())}/v2.0/adminconsent`,
  );
  url.searchParams.set("client_id", clientId.trim());
  url.searchParams.set("scope", LOG_ANALYTICS_ADMIN_CONSENT_SCOPE);
  url.searchParams.set("redirect_uri", `${origin}${REDIRECT_PATH}`);
  url.searchParams.set("state", LOG_ANALYTICS_ADMIN_CONSENT_STATE);
  return url.toString();
}
