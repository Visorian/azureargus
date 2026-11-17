import { createDnsDetailHandler } from '../../../utils/managedLogAnalyticsHandlers'
import { requireOidcSession } from '../../../utils/oidcRouteSession'

export default defineEventHandler(
  createDnsDetailHandler({
    getRuntimeConfig: useRuntimeConfig,
    requireSession: requireOidcSession,
  }),
)
