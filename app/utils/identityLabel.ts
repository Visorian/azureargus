import type { UserSession } from 'nuxt-oidc-auth/runtime/types.js'

export function identityLabel(user: UserSession | undefined, loggedIn: boolean): string {
  const userName = user?.userName
  if (userName !== undefined && userName.trim() !== '') {
    return userName
  }

  for (const key of ['preferred_username', 'email', 'name']) {
    const value = user?.claims?.[key]
    if (typeof value === 'string' && value.trim()) {
      return value
    }
  }

  return loggedIn ? 'Authenticated' : 'Not signed in'
}
