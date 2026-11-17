import { createDnsReadinessHandler } from '../../../utils/managedLogAnalyticsHandlers'
import { requireOidcSession } from '../../../utils/oidcRouteSession'

export default defineEventHandler(
  createDnsReadinessHandler({
    getRuntimeConfig: useRuntimeConfig,
    requireSession: requireOidcSession,
  }),
)
