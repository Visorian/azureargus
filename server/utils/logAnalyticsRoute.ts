import { createError, getHeader, setResponseHeader, type H3Event } from "h3";

import { LogAnalyticsConfigurationError, LogAnalyticsTokenError } from "./logAnalyticsAuth";

const BEARER_AUTHORIZATION_PATTERN = /^Bearer ([^\s]+)$/;
import { LogAnalyticsQueryError } from "./logAnalyticsQuery";

export function createIncomingRequestSignal(event: H3Event) {
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

export function readDelegatedLogAnalyticsBearerToken(event: H3Event) {
  const authorization = getHeader(event, "authorization");
  const match = authorization?.match(BEARER_AUTHORIZATION_PATTERN);
  const token = match?.[1];
  if (!token) {
    throw createError({
      statusCode: 401,
      message: "Delegated Log Analytics access token is required",
    });
  }
  return token;
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

export function throwLogAnalyticsUpstreamError(event: H3Event, error: unknown): never {
  if (error instanceof LogAnalyticsConfigurationError) {
    throw createError({
      statusCode: 503,
      message: "Log Analytics is not configured",
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
