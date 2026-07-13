import { createError, getHeader, readValidatedBody, type H3Event } from "h3";

import type { DelegatedLogAnalyticsQueryRequest } from "../../../shared/types/logAnalytics";
import { parseDeploymentCapabilities } from "../../utils/deploymentCapabilities";
import {
  executeLogAnalyticsQuery,
  validateDelegatedLogAnalyticsQueryRequest,
} from "../../utils/logAnalyticsQuery";
import {
  createIncomingRequestSignal,
  throwLogAnalyticsUpstreamError,
} from "../../utils/logAnalyticsRoute";

function readBearerToken(event: H3Event) {
  const authorization = getHeader(event, "authorization");
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  const token = match?.[1];
  if (!token) {
    throw createError({
      statusCode: 401,
      message: "Delegated Log Analytics access token is required",
    });
  }

  return token;
}

export default defineEventHandler(async (event) => {
  const runtimeConfig = useRuntimeConfig(event);
  const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env);
  if (capabilities.mode !== "anonymous" || !capabilities.temporaryLogAnalyticsAuthAvailable) {
    throw createError({
      statusCode: capabilities.mode === "invalid" ? 503 : 403,
      message: "Delegated Log Analytics is unavailable",
    });
  }

  const accessToken = readBearerToken(event);
  const request = await readValidatedBody<DelegatedLogAnalyticsQueryRequest>(event, (body) =>
    validateDelegatedLogAnalyticsQueryRequest(body) ? body : false,
  );
  const { workspaceId, ...queryRequest } = request;
  if (typeof workspaceId !== "string") {
    throw createError({ statusCode: 400, message: "Workspace ID is required" });
  }
  const incomingRequest = createIncomingRequestSignal(event);

  try {
    return await executeLogAnalyticsQuery({ workspaceId }, queryRequest, accessToken, {
      signal: incomingRequest.signal,
    });
  } catch (error) {
    throwLogAnalyticsUpstreamError(event, error);
  } finally {
    incomingRequest.cleanup();
  }
});
