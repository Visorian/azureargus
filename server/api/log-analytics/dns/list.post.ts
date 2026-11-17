import { createDnsListHandler } from '../../../utils/managedLogAnalyticsHandlers'
import { requireOidcSession } from '../../../utils/oidcRouteSession'

export default defineEventHandler(
  createDnsListHandler({
    getRuntimeConfig: useRuntimeConfig,
    requireSession: requireOidcSession,
  }),
)
