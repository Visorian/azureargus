import type { AzureLogAnalyticsAccess } from '#shared/types/azureAccess'
import type {
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsReadinessResponse,
} from '#shared/types/dns'
import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
} from '#shared/types/logAnalytics'
import {
  AzureResourceDiscoveryError,
  discoverAzureLogAnalyticsAccess,
} from '#shared/utils/azureResourceDiscovery'
import {
  executeDnsDetailQuery,
  executeDnsListQuery,
  executeDnsReadinessQuery,
} from '#shared/utils/dnsLogAnalyticsQuery'
import {
  executeLogAnalyticsQuery,
  isLogAnalyticsWorkspaceId,
  LogAnalyticsQueryError,
} from '#shared/utils/logAnalyticsQuery'
import type { LogAnalyticsQueryErrorKind } from '#shared/utils/logAnalyticsQuery'
import { isEntraId } from '~/utils/logAnalyticsOnboarding'

const DEFAULT_DISCOVERY_TIMEOUT_MS = 15_000

interface TemporaryLogAnalyticsTokenProvider {
  getLogAnalyticsAccessToken(tenantId: string, allowInteractive?: boolean): Promise<string>
  getManagementAccessToken(tenantId: string, allowInteractive?: boolean): Promise<string>
}

interface TemporaryLogAnalyticsClientOptions {
  discoveryTimeoutMs?: number
  fetchImplementation?: typeof fetch
}

export class TemporaryLogAnalyticsClientError extends Error {
  readonly kind: LogAnalyticsQueryErrorKind | 'validation'
  readonly retryAfterSeconds: number | undefined

  constructor(
    message: string,
    kind: LogAnalyticsQueryErrorKind | 'validation',
    retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'TemporaryLogAnalyticsClientError'
    this.kind = kind
    this.retryAfterSeconds = retryAfterSeconds
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted', 'AbortError')
}

async function withTimeout<T>(
  signal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  if (signal.aborted) {
    throw abortReason(signal)
  }
  const controller = new AbortController()
  let rejectForAbort!: (reason: unknown) => void
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectForAbort = reject
  })
  const handleAbort = () => {
    const reason = abortReason(signal)
    rejectForAbort(reason)
    controller.abort(reason)
  }
  signal.addEventListener('abort', handleAbort, { once: true })
  const timeout = setTimeout(() => {
    const error = new TemporaryLogAnalyticsClientError(
      'Azure resource discovery timed out.',
      'timeout',
    )
    rejectForAbort(error)
    controller.abort(error)
  }, timeoutMs)

  try {
    return await Promise.race([operation(controller.signal), aborted])
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', handleAbort)
    controller.abort()
  }
}

function validateTenantId(tenantId: string) {
  const normalized = tenantId.trim()
  if (!isEntraId(normalized)) {
    throw new TemporaryLogAnalyticsClientError('Azure directory is invalid.', 'validation')
  }
  return normalized
}

function validateWorkspaceId(workspaceId: string) {
  const normalized = workspaceId.trim()
  if (!isLogAnalyticsWorkspaceId(normalized)) {
    throw new TemporaryLogAnalyticsClientError('Log Analytics workspace is invalid.', 'validation')
  }
  return normalized
}

function toLogAnalyticsClientError(error: unknown): Error {
  if (error instanceof TemporaryLogAnalyticsClientError) {
    return error
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return error
  }
  if (!(error instanceof LogAnalyticsQueryError)) {
    return new TemporaryLogAnalyticsClientError('Log Analytics request failed.', 'upstream')
  }
  if (error.kind === 'authorization') {
    return new TemporaryLogAnalyticsClientError('Log Analytics authorization failed.', error.kind)
  }
  if (error.kind === 'throttled') {
    const retry =
      error.retryAfterSeconds === undefined
        ? ''
        : ` Try again in ${error.retryAfterSeconds} seconds.`
    return new TemporaryLogAnalyticsClientError(
      `Log Analytics is throttling requests.${retry}`,
      error.kind,
      error.retryAfterSeconds,
    )
  }
  if (error.kind === 'timeout') {
    return new TemporaryLogAnalyticsClientError('Log Analytics request timed out.', error.kind)
  }
  return new TemporaryLogAnalyticsClientError('Log Analytics request failed.', error.kind)
}

function toDiscoveryClientError(error: unknown): Error {
  if (error instanceof TemporaryLogAnalyticsClientError) {
    return error
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return error
  }
  if (!(error instanceof AzureResourceDiscoveryError)) {
    return new TemporaryLogAnalyticsClientError('Azure resource discovery failed.', 'upstream')
  }
  if (error.status === 401 || error.status === 403) {
    return new TemporaryLogAnalyticsClientError(
      'Azure resource discovery was denied.',
      'authorization',
    )
  }
  if (error.status === 429) {
    return new TemporaryLogAnalyticsClientError(
      'Azure resource discovery is throttled.',
      'throttled',
    )
  }
  return new TemporaryLogAnalyticsClientError('Azure resource discovery failed.', 'upstream')
}

export function createTemporaryLogAnalyticsClient(
  tokenProvider: TemporaryLogAnalyticsTokenProvider,
  options: TemporaryLogAnalyticsClientOptions = {},
) {
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch

  async function withLogAnalyticsToken<T>(
    tenantId: string,
    workspaceId: string,
    signal: AbortSignal,
    operation: (accessToken: string, workspaceId: string) => Promise<T>,
  ) {
    const normalizedTenantId = validateTenantId(tenantId)
    const normalizedWorkspaceId = validateWorkspaceId(workspaceId)
    try {
      const accessToken = await tokenProvider.getLogAnalyticsAccessToken(normalizedTenantId, false)
      if (signal.aborted) {
        throw abortReason(signal)
      }
      return await operation(accessToken, normalizedWorkspaceId)
    } catch (error: unknown) {
      throw toLogAnalyticsClientError(error)
    }
  }

  return {
    async discover(tenantId: string, signal: AbortSignal): Promise<AzureLogAnalyticsAccess> {
      const normalizedTenantId = validateTenantId(tenantId)
      try {
        return await withTimeout(
          signal,
          options.discoveryTimeoutMs ?? DEFAULT_DISCOVERY_TIMEOUT_MS,
          async (boundedSignal) => {
            const accessToken = await tokenProvider.getManagementAccessToken(
              normalizedTenantId,
              false,
            )
            if (boundedSignal.aborted) {
              throw abortReason(boundedSignal)
            }
            return discoverAzureLogAnalyticsAccess(accessToken, boundedSignal, fetchImplementation)
          },
        )
      } catch (error: unknown) {
        throw toDiscoveryClientError(error)
      }
    },

    async query(
      tenantId: string,
      workspaceId: string,
      request: LogAnalyticsQueryRequest,
      signal: AbortSignal,
    ): Promise<LogAnalyticsQueryResponse> {
      return withLogAnalyticsToken(
        tenantId,
        workspaceId,
        signal,
        async (accessToken, targetWorkspace) =>
          executeLogAnalyticsQuery({ workspaceId: targetWorkspace }, request, accessToken, {
            fetchImplementation,
            signal,
          }),
      )
    },

    async dnsReadiness(
      tenantId: string,
      workspaceId: string,
      signal: AbortSignal,
    ): Promise<DnsReadinessResponse> {
      return withLogAnalyticsToken(
        tenantId,
        workspaceId,
        signal,
        async (accessToken, targetWorkspace) =>
          executeDnsReadinessQuery({ workspaceId: targetWorkspace }, accessToken, {
            fetchImplementation,
            signal,
          }),
      )
    },

    async dnsList(
      tenantId: string,
      workspaceId: string,
      request: DnsListQueryRequest,
      signal: AbortSignal,
    ): Promise<DnsListQueryResponse> {
      return withLogAnalyticsToken(
        tenantId,
        workspaceId,
        signal,
        async (accessToken, targetWorkspace) =>
          executeDnsListQuery({ workspaceId: targetWorkspace }, request, accessToken, {
            fetchImplementation,
            signal,
          }),
      )
    },

    async dnsDetail(
      tenantId: string,
      workspaceId: string,
      request: DnsDetailQueryRequest,
      signal: AbortSignal,
    ): Promise<DnsDetailQueryResponse> {
      return withLogAnalyticsToken(
        tenantId,
        workspaceId,
        signal,
        async (accessToken, targetWorkspace) =>
          executeDnsDetailQuery({ workspaceId: targetWorkspace }, request, accessToken, {
            fetchImplementation,
            signal,
          }),
      )
    },
  }
}
