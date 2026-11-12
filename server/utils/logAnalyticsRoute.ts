import { createError, setResponseHeader } from 'h3'
import type { H3Error, H3Event } from 'h3'

import { LogAnalyticsQueryError } from '../../shared/utils/logAnalyticsQuery'
import { LogAnalyticsConfigurationError, LogAnalyticsTokenError } from './logAnalyticsAuth'

export function createIncomingRequestSignal(event: H3Event) {
  const controller = new AbortController()
  const abort = () => {
    controller.abort()
  }
  const abortOnClosedResponse = () => {
    if (!event.node.res.writableEnded) {
      abort()
    }
  }
  const webSignal = event.web?.request?.signal

  if (webSignal?.aborted) {
    abort()
  } else {
    webSignal?.addEventListener('abort', abort, { once: true })
  }
  event.node.req.once('aborted', abort)
  event.node.res.once('close', abortOnClosedResponse)

  return {
    signal: controller.signal,
    cleanup() {
      webSignal?.removeEventListener('abort', abort)
      event.node.req.off('aborted', abort)
      event.node.res.off('close', abortOnClosedResponse)
    },
  }
}

function createThrottledError(event: H3Event, retryAfterSeconds?: number): H3Error {
  if (retryAfterSeconds !== undefined) {
    setResponseHeader(event, 'retry-after', retryAfterSeconds)
  }

  return createError({
    statusCode: 429,
    message: 'Log Analytics is throttling requests',
    data: retryAfterSeconds === undefined ? undefined : { retryAfterSeconds },
  })
}

/** Maps a Log Analytics failure to the HTTP error the route should throw. */
export function createLogAnalyticsUpstreamError(event: H3Event, error: unknown): H3Error {
  if (error instanceof LogAnalyticsConfigurationError) {
    return createError({
      statusCode: 503,
      message: 'Log Analytics is not configured',
    })
  }

  if (error instanceof LogAnalyticsTokenError) {
    if (error.kind === 'authorization') {
      return createError({
        statusCode: 403,
        message: 'Log Analytics authorization failed',
      })
    }
    if (error.kind === 'throttled') {
      return createThrottledError(event, error.retryAfterSeconds)
    }

    return createError({
      statusCode: 502,
      message: 'Log Analytics token service is unavailable',
    })
  }

  if (error instanceof LogAnalyticsQueryError) {
    if (error.kind === 'authorization') {
      return createError({
        statusCode: 403,
        message: 'Log Analytics authorization failed',
      })
    }
    if (error.kind === 'throttled') {
      return createThrottledError(event, error.retryAfterSeconds)
    }
    if (error.kind === 'timeout') {
      return createError({
        statusCode: 504,
        message: 'Log Analytics request timed out',
      })
    }
  }

  return createError({
    statusCode: 502,
    message: 'Log Analytics request failed',
  })
}
