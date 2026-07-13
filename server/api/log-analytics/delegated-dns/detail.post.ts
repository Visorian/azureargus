import { createError, readValidatedBody } from "h3";

import type { DelegatedDnsDetailQueryRequest } from "../../../../shared/types/dns";
import { parseDeploymentCapabilities } from "../../../utils/deploymentCapabilities";
import {
  executeDnsDetailQuery,
  validateDelegatedDnsDetailQueryRequest,
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
  const request = await readValidatedBody<DelegatedDnsDetailQueryRequest>(event, (body) =>
    validateDelegatedDnsDetailQueryRequest(body) ? body : false,
  );
  const { workspaceId, ...queryRequest } = request;
  const incoming = createIncomingRequestSignal(event);
  try {
    return await executeDnsDetailQuery({ workspaceId }, queryRequest, token, {
      signal: incoming.signal,
    });
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  } finally {
    incoming.cleanup();
  }
});
