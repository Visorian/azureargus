import type { UserSession } from 'nuxt-oidc-auth/runtime/types.js'

import { identityLabel } from '../../app/utils/identityLabel'

const session = {
  provider: 'entra',
  canRefresh: false,
  expireAt: 1,
} satisfies UserSession

describe('session identity label', () => {
  it('uses the OIDC session user name before claims', () => {
    expect(
      identityLabel({ ...session, userName: 'Architect', claims: { name: 'Claim name' } }, true),
    ).toBe('Architect')
  })

  it('uses available identity claims when the session has no display name', () => {
    expect(
      identityLabel({ ...session, claims: { preferred_username: 'architect@example.com' } }, true),
    ).toBe('architect@example.com')
    expect(identityLabel({ ...session, claims: { email: 'mail@example.com' } }, true)).toBe(
      'mail@example.com',
    )
    expect(identityLabel({ ...session, claims: { name: 'Architect' } }, true)).toBe('Architect')
  })

  it('distinguishes authenticated and signed-out sessions without a label', () => {
    expect(identityLabel(session, true)).toBe('Authenticated')
    expect(identityLabel(undefined, false)).toBe('Not signed in')
  })
})
