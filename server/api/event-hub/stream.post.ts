import { getUserSessionId } from 'nuxt-oidc-auth/runtime/server/utils/session.js'

import { createManagedEventHubStreamHandler } from '../../utils/managedEventHubStreamHandler'
import { requireOidcSession } from '../../utils/oidcRouteSession'

export default defineEventHandler(
  createManagedEventHubStreamHandler({
    getRuntimeConfig: useRuntimeConfig,
    requireSession: requireOidcSession,
    getSessionId: getUserSessionId,
  }),
)
