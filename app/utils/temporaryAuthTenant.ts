import type { AccountInfo } from '@azure/msal-browser'

export class UnexpectedTemporaryAuthTenant extends Error {}

export function assertAuthenticationTenant(
  result: { account?: AccountInfo | null; tenantId?: string },
  tenantId: string,
): void {
  const resultTenantId = result.tenantId || result.account?.tenantId
  if (resultTenantId !== tenantId) {
    throw new UnexpectedTemporaryAuthTenant()
  }
}
