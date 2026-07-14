import {
  createLogAnalyticsAdminConsentUrl,
  isEntraId,
  LOG_ANALYTICS_ADMIN_CONSENT_STATE,
  LOG_ANALYTICS_WORKSPACES_URL,
} from "../../app/utils/logAnalyticsOnboarding";

const tenantId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";

describe("Log Analytics onboarding", () => {
  it("builds target-tenant admin consent for configured delegated permissions", () => {
    const value = createLogAnalyticsAdminConsentUrl(
      ` ${tenantId} `,
      ` ${clientId} `,
      "https://argus.example.com",
    );
    const url = new URL(value!);

    expect(url.origin + url.pathname).toBe(
      `https://login.microsoftonline.com/${tenantId}/v2.0/adminconsent`,
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: clientId,
      redirect_uri: "https://argus.example.com/log-analytics-redirect.html",
      scope: "https://api.loganalytics.io/.default",
      state: LOG_ANALYTICS_ADMIN_CONSENT_STATE,
    });
  });

  it("rejects malformed tenant or client IDs", () => {
    expect(isEntraId(tenantId)).toBe(true);
    expect(isEntraId("organizations")).toBe(false);
    expect(
      createLogAnalyticsAdminConsentUrl("invalid", clientId, "https://example.com"),
    ).toBeNull();
    expect(
      createLogAnalyticsAdminConsentUrl(tenantId, "invalid", "https://example.com"),
    ).toBeNull();
  });

  it("opens Azure portal workspace inventory for IAM selection", () => {
    expect(LOG_ANALYTICS_WORKSPACES_URL).toBe(
      "https://portal.azure.com/#view/HubsExtension/BrowseResource/resourceType/Microsoft.OperationalInsights%2Fworkspaces",
    );
  });
});
