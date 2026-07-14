import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";
import { createError } from "h3";

import { parseDeploymentCapabilities } from "../../../utils/deploymentCapabilities";
import { executeDnsReadinessQuery } from "../../../utils/dnsLogAnalyticsQuery";
import {
  getLogAnalyticsAccessToken,
  parseLogAnalyticsRuntimeConfig,
} from "../../../utils/logAnalyticsAuth";
import {
  createIncomingRequestSignal,
  throwLogAnalyticsUpstreamError,
} from "../../../utils/logAnalyticsRoute";

export default defineEventHandler(async (event) => {
  await requireUserSession(event, { errorBehavior: "throw" });
  const runtimeConfig = useRuntimeConfig(event);
  const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env);
  if (capabilities.mode !== "managed" || !capabilities.predefinedLogAnalyticsAvailable) {
    throw createError({
      statusCode: capabilities.mode === "invalid" ? 503 : 403,
      message: "Managed Log Analytics is unavailable",
    });
  }

  let config;
  try {
    config = parseLogAnalyticsRuntimeConfig(runtimeConfig.logAnalytics);
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  }
  const incoming = createIncomingRequestSignal(event);
  try {
    const token = await getLogAnalyticsAccessToken(config, incoming.signal);
    return await executeDnsReadinessQuery(config, token, { signal: incoming.signal });
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  } finally {
    incoming.cleanup();
  }
});
