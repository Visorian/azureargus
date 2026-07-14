import { createError, readValidatedBody } from "h3";

import type { DelegatedDnsReadinessRequest } from "../../../../shared/types/dns";
import { parseDeploymentCapabilities } from "../../../utils/deploymentCapabilities";
import {
  executeDnsReadinessQuery,
  validateDelegatedDnsReadinessRequest,
} from "../../../utils/dnsLogAnalyticsQuery";
import {
  createIncomingRequestSignal,
  readDelegatedLogAnalyticsBearerToken,
  throwLogAnalyticsUpstreamError,
} from "../../../utils/logAnalyticsRoute";

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env);
  if (capabilities.mode !== "anonymous" || !capabilities.temporaryLogAnalyticsAuthAvailable) {
    throw createError({
      statusCode: capabilities.mode === "invalid" ? 503 : 403,
      message: "Delegated Log Analytics is unavailable",
    });
  }

  const token = readDelegatedLogAnalyticsBearerToken(event);
  const request = await readValidatedBody<DelegatedDnsReadinessRequest>(event, (body) =>
    validateDelegatedDnsReadinessRequest(body) ? body : false,
  );
  const incoming = createIncomingRequestSignal(event);
  try {
    return await executeDnsReadinessQuery({ workspaceId: request.workspaceId }, token, {
      signal: incoming.signal,
    });
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  } finally {
    incoming.cleanup();
  }
});
