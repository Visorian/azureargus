import { requireUserSession } from "nuxt-oidc-auth/runtime/server/utils/session.js";
import { createError, readValidatedBody, setResponseHeader, type H3Event } from "h3";

import type { LogAnalyticsQueryRequest } from "../../../shared/types/logAnalytics";
import {
  getLogAnalyticsAccessToken,
  LogAnalyticsConfigurationError,
  LogAnalyticsSessionAuthorizationError,
  LogAnalyticsTokenError,
  parseAuthorizedLogAnalyticsRuntimeConfig,
} from "../../utils/logAnalyticsAuth";
import {
  executeLogAnalyticsQuery,
  LogAnalyticsQueryError,
  validateLogAnalyticsQueryRequest,
} from "../../utils/logAnalyticsQuery";

function createIncomingRequestSignal(event: H3Event) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const abortOnClosedResponse = () => {
    if (!event.node.res.writableEnded) {
      abort();
    }
  };
  const webSignal = event.web?.request?.signal;

  if (webSignal?.aborted) {
    abort();
  } else {
    webSignal?.addEventListener("abort", abort, { once: true });
  }
  event.node.req.once("aborted", abort);
  event.node.res.once("close", abortOnClosedResponse);

  return {
    signal: controller.signal,
    cleanup() {
      webSignal?.removeEventListener("abort", abort);
      event.node.req.off("aborted", abort);
      event.node.res.off("close", abortOnClosedResponse);
    },
  };
}

function throwThrottledError(event: H3Event, retryAfterSeconds?: number): never {
  if (retryAfterSeconds !== undefined) {
    setResponseHeader(event, "retry-after", retryAfterSeconds);
  }

  throw createError({
    statusCode: 429,
    message: "Log Analytics is throttling requests",
    data: retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
  });
}

function throwUpstreamError(event: H3Event, error: unknown): never {
  if (error instanceof LogAnalyticsConfigurationError) {
    throw createError({
      statusCode: 503,
      message: "Log Analytics is not configured",
    });
  }

  if (error instanceof LogAnalyticsSessionAuthorizationError) {
    throw createError({
      statusCode: 403,
      message: "Log Analytics access is forbidden",
    });
  }

  if (error instanceof LogAnalyticsTokenError) {
    if (error.kind === "authorization") {
      throw createError({
        statusCode: 403,
        message: "Log Analytics authorization failed",
      });
    }
    if (error.kind === "throttled") {
      throwThrottledError(event, error.retryAfterSeconds);
    }

    throw createError({
      statusCode: 502,
      message: "Log Analytics token service is unavailable",
    });
  }

  if (error instanceof LogAnalyticsQueryError) {
    if (error.kind === "authorization") {
      throw createError({
        statusCode: 403,
        message: "Log Analytics authorization failed",
      });
    }
    if (error.kind === "throttled") {
      throwThrottledError(event, error.retryAfterSeconds);
    }
    if (error.kind === "timeout") {
      throw createError({
        statusCode: 504,
        message: "Log Analytics request timed out",
      });
    }
  }

  throw createError({
    statusCode: 502,
    message: "Log Analytics request failed",
  });
}

export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event, { errorBehavior: "throw" });
  const runtimeConfig = useRuntimeConfig(event);

  let config;
  try {
    config = parseAuthorizedLogAnalyticsRuntimeConfig(session, runtimeConfig.logAnalytics);
  } catch (error) {
    throwUpstreamError(event, error);
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
    throwUpstreamError(event, error);
  } finally {
    incomingRequest.cleanup();
  }
});
