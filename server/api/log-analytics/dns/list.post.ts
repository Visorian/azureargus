import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";
import { createError, readValidatedBody } from "h3";

import type { DnsListQueryRequest } from "../../../../shared/types/dns";
import { parseDeploymentCapabilities } from "../../../utils/deploymentCapabilities";
import {
  executeDnsListQuery,
  validateDnsListQueryRequest,
} from "../../../utils/dnsLogAnalyticsQuery";
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
  const request = await readValidatedBody<DnsListQueryRequest>(event, (body) =>
    validateDnsListQueryRequest(body) ? body : false,
  );
  const incoming = createIncomingRequestSignal(event);
  try {
    const token = await getLogAnalyticsAccessToken(config, incoming.signal);
    return await executeDnsListQuery(config, request, token, { signal: incoming.signal });
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  } finally {
    incoming.cleanup();
  }
});
