import { createError } from "h3";

import { parseDeploymentCapabilities } from "../../utils/deploymentCapabilities";
import {
  AzureResourceDiscoveryError,
  discoverAzureLogAnalyticsAccess,
} from "../../utils/azureResourceDiscovery";
import { createIncomingRequestSignal, readBearerToken } from "../../utils/logAnalyticsRoute";

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env);
  if (capabilities.mode !== "anonymous" || !capabilities.temporaryLogAnalyticsAuthAvailable) {
    throw createError({
      statusCode: capabilities.mode === "invalid" ? 503 : 403,
      message: "Delegated Azure access discovery is unavailable",
    });
  }

  const accessToken = readBearerToken(event, "Azure Resource Manager access token is required");
  const incoming = createIncomingRequestSignal(event);
  try {
    return await discoverAzureLogAnalyticsAccess(accessToken, incoming.signal);
  } catch (error: unknown) {
    if (error instanceof AzureResourceDiscoveryError) {
      if (error.status === 401 || error.status === 403) {
        throw createError({ statusCode: 403, message: "Azure resource discovery was denied" });
      }
      if (error.status === 429) {
        throw createError({ statusCode: 429, message: "Azure resource discovery is throttled" });
      }
    }
    throw createError({ statusCode: 502, message: "Azure resource discovery failed" });
  } finally {
    incoming.cleanup();
  }
});
