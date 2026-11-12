import { createError, readValidatedBody } from 'h3'
import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'

import type { DnsDetailQueryRequest } from '../../../../shared/types/dns'
import {
  executeDnsDetailQuery,
  validateDnsDetailQueryRequest,
} from '../../../../shared/utils/dnsLogAnalyticsQuery'
import { parseDeploymentCapabilities } from '../../../utils/deploymentCapabilities'
import {
  getLogAnalyticsAccessToken,
  parseLogAnalyticsRuntimeConfig,
} from '../../../utils/logAnalyticsAuth'
import {
  createIncomingRequestSignal,
  createLogAnalyticsUpstreamError,
} from '../../../utils/logAnalyticsRoute'

export default defineEventHandler(async (event) => {
  await requireUserSession(event, { errorBehavior: 'throw' })
  const runtimeConfig = useRuntimeConfig(event)
  const capabilities = parseDeploymentCapabilities(runtimeConfig, process.env)
  if (capabilities.mode !== 'managed' || !capabilities.predefinedLogAnalyticsAvailable) {
    throw createError({
      statusCode: capabilities.mode === 'invalid' ? 503 : 403,
      message: 'Managed Log Analytics is unavailable',
    })
  }

  let config
  try {
    config = parseLogAnalyticsRuntimeConfig(runtimeConfig.logAnalytics)
  } catch (error) {
    throw createLogAnalyticsUpstreamError(event, error)
  }
  const request = await readValidatedBody<DnsDetailQueryRequest>(event, (body) =>
    validateDnsDetailQueryRequest(body) ? body : false,
  )
  const incoming = createIncomingRequestSignal(event)
  try {
    const token = await getLogAnalyticsAccessToken(config, incoming.signal)
    return await executeDnsDetailQuery(config, request, token, { signal: incoming.signal })
  } catch (error) {
    throw createLogAnalyticsUpstreamError(event, error)
  } finally {
    incoming.cleanup()
  }
})
