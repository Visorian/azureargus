import { createLogAnalyticsQueryHandler } from '../../utils/managedLogAnalyticsHandlers'
import { requireOidcSession } from '../../utils/oidcRouteSession'

export default defineEventHandler(
  createLogAnalyticsQueryHandler({
    getRuntimeConfig: useRuntimeConfig,
    requireSession: requireOidcSession,
  }),
)
