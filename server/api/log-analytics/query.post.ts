import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";
import { createError, readValidatedBody } from "h3";

import type { LogAnalyticsQueryRequest } from "../../../shared/types/logAnalytics";
import { parseDeploymentCapabilities } from "../../utils/deploymentCapabilities";
import {
  getLogAnalyticsAccessToken,
  parseLogAnalyticsRuntimeConfig,
} from "../../utils/logAnalyticsAuth";
import {
  executeLogAnalyticsQuery,
  validateLogAnalyticsQueryRequest,
} from "../../utils/logAnalyticsQuery";
import {
  createIncomingRequestSignal,
  throwLogAnalyticsUpstreamError,
} from "../../utils/logAnalyticsRoute";

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

  const request = await readValidatedBody<LogAnalyticsQueryRequest>(event, (body) =>
    validateLogAnalyticsQueryRequest(body) ? body : false,
  );
  const incomingRequest = createIncomingRequestSignal(event);

  try {
    const accessToken = await getLogAnalyticsAccessToken(config, incomingRequest.signal);
    return await executeLogAnalyticsQuery(config, request, accessToken, {
      signal: incomingRequest.signal,
    });
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  } finally {
    incomingRequest.cleanup();
  }
});
