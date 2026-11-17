import { createError, readValidatedBody } from 'h3'
import type { H3Event } from 'h3'

import type {
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsReadinessResponse,
} from '../../shared/types/dns'
import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
} from '../../shared/types/logAnalytics'
import {
  executeDnsDetailQuery,
  executeDnsListQuery,
  executeDnsReadinessQuery,
  validateDnsDetailQueryRequest,
  validateDnsListQueryRequest,
} from '../../shared/utils/dnsLogAnalyticsQuery'
import {
  executeLogAnalyticsQuery,
  validateLogAnalyticsQueryRequest,
} from '../../shared/utils/logAnalyticsQuery'
import { parseDeploymentCapabilities } from './deploymentCapabilities'
import { getLogAnalyticsAccessToken, parseLogAnalyticsRuntimeConfig } from './logAnalyticsAuth'
import type { LogAnalyticsAccessTokenProvider, LogAnalyticsRuntimeConfig } from './logAnalyticsAuth'
import { createIncomingRequestSignal, createLogAnalyticsUpstreamError } from './logAnalyticsRoute'

export interface ManagedLogAnalyticsRuntimeConfig {
  logAnalytics: LogAnalyticsRuntimeConfig
}

export interface ManagedLogAnalyticsRouteDependencies {
  getRuntimeConfig: (event: H3Event) => ManagedLogAnalyticsRuntimeConfig
  /** Rejects when the request has no application login session. */
  requireSession: (event: H3Event) => Promise<unknown>
  getAccessToken?: LogAnalyticsAccessTokenProvider
}

interface ManagedLogAnalyticsOperation<TRequest, TResponse> {
  readRequest: (event: H3Event) => Promise<TRequest>
  execute: (
    config: LogAnalyticsRuntimeConfig,
    request: TRequest,
    accessToken: string,
    signal: AbortSignal,
  ) => Promise<TResponse>
}

type ManagedLogAnalyticsHandler<TResponse> = (event: H3Event) => Promise<TResponse>

function createManagedLogAnalyticsHandler<TRequest, TResponse>(
  {
    getRuntimeConfig,
    requireSession,
    getAccessToken = getLogAnalyticsAccessToken,
  }: ManagedLogAnalyticsRouteDependencies,
  { readRequest, execute }: ManagedLogAnalyticsOperation<TRequest, TResponse>,
): ManagedLogAnalyticsHandler<TResponse> {
  return async (event) => {
    await requireSession(event)
    const runtimeConfig = getRuntimeConfig(event)
    const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env)
    if (capabilities.mode !== 'managed' || !capabilities.predefinedLogAnalyticsAvailable) {
      throw createError({
        statusCode: capabilities.mode === 'invalid' ? 503 : 403,
        message: 'Managed Log Analytics is unavailable',
      })
    }

    let config: LogAnalyticsRuntimeConfig
    try {
      config = parseLogAnalyticsRuntimeConfig(runtimeConfig.logAnalytics)
    } catch (error) {
      throw createLogAnalyticsUpstreamError(event, error)
    }

    const request = await readRequest(event)
    const incomingRequest = createIncomingRequestSignal(event)
    try {
      const accessToken = await getAccessToken(config, incomingRequest.signal)
      return await execute(config, request, accessToken, incomingRequest.signal)
    } catch (error) {
      throw createLogAnalyticsUpstreamError(event, error)
    } finally {
      incomingRequest.cleanup()
    }
  }
}

export interface LogAnalyticsQueryRouteDependencies extends ManagedLogAnalyticsRouteDependencies {
  executeQuery?: typeof executeLogAnalyticsQuery
}

export function createLogAnalyticsQueryHandler({
  executeQuery = executeLogAnalyticsQuery,
  ...dependencies
}: LogAnalyticsQueryRouteDependencies): ManagedLogAnalyticsHandler<LogAnalyticsQueryResponse> {
  return createManagedLogAnalyticsHandler(dependencies, {
    readRequest: async (event) =>
      await readValidatedBody<LogAnalyticsQueryRequest>(event, (body) =>
        validateLogAnalyticsQueryRequest(body) ? body : false,
      ),
    execute: async (config, request, accessToken, signal) =>
      await executeQuery(config, request, accessToken, { signal }),
  })
}

export interface DnsListRouteDependencies extends ManagedLogAnalyticsRouteDependencies {
  executeQuery?: typeof executeDnsListQuery
}

export function createDnsListHandler({
  executeQuery = executeDnsListQuery,
  ...dependencies
}: DnsListRouteDependencies): ManagedLogAnalyticsHandler<DnsListQueryResponse> {
  return createManagedLogAnalyticsHandler(dependencies, {
    readRequest: async (event) =>
      await readValidatedBody<DnsListQueryRequest>(event, (body) =>
        validateDnsListQueryRequest(body) ? body : false,
      ),
    execute: async (config, request, accessToken, signal) =>
      await executeQuery(config, request, accessToken, { signal }),
  })
}

export interface DnsDetailRouteDependencies extends ManagedLogAnalyticsRouteDependencies {
  executeQuery?: typeof executeDnsDetailQuery
}

export function createDnsDetailHandler({
  executeQuery = executeDnsDetailQuery,
  ...dependencies
}: DnsDetailRouteDependencies): ManagedLogAnalyticsHandler<DnsDetailQueryResponse> {
  return createManagedLogAnalyticsHandler(dependencies, {
    readRequest: async (event) =>
      await readValidatedBody<DnsDetailQueryRequest>(event, (body) =>
        validateDnsDetailQueryRequest(body) ? body : false,
      ),
    execute: async (config, request, accessToken, signal) =>
      await executeQuery(config, request, accessToken, { signal }),
  })
}

export interface DnsReadinessRouteDependencies extends ManagedLogAnalyticsRouteDependencies {
  executeQuery?: typeof executeDnsReadinessQuery
}

export function createDnsReadinessHandler({
  executeQuery = executeDnsReadinessQuery,
  ...dependencies
}: DnsReadinessRouteDependencies): ManagedLogAnalyticsHandler<DnsReadinessResponse> {
  return createManagedLogAnalyticsHandler(dependencies, {
    // Readiness takes no caller input.
    readRequest: async () => null,
    execute: async (config, _request, accessToken, signal) =>
      await executeQuery(config, accessToken, { signal }),
  })
}
