import type { H3Event } from 'h3'
import { requireUserSession } from 'nuxt-oidc-auth/runtime/server/utils/session.js'
import type { UserSession } from 'nuxt-oidc-auth/runtime/types.js'

/** Production session reader for managed routes: rejects requests without an application login. */
export async function requireOidcSession(event: H3Event): Promise<UserSession> {
  return await requireUserSession(event, { errorBehavior: 'throw' })
}
