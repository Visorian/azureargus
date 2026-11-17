import type { ComputedRef, Ref } from 'vue'

import type { AzureAccessibleTenant, AzureAccessibleWorkspace } from '#shared/types/azureAccess'
import type { TemporaryLogAnalyticsAuth } from '~/composables/useTemporaryLogAnalyticsAuth'
import { createLogAnalyticsAdminConsentUrl, isEntraId } from '~/utils/logAnalyticsOnboarding'
import { createTemporaryLogAnalyticsClient } from '~/utils/temporaryLogAnalyticsClient.client'
import type { TemporaryLogAnalyticsClient } from '~/utils/temporaryLogAnalyticsClient.client'

export type TemporaryAccessStatus = 'idle' | 'loading' | 'success' | 'error'

export interface UseTemporaryLogAnalyticsWorkspaceReturn {
  temporaryLogAnalyticsAuth: TemporaryLogAnalyticsAuth
  temporaryLogAnalyticsClient: TemporaryLogAnalyticsClient
  temporaryTenantId: Ref<string>
  temporaryWorkspaceId: Ref<string>
  temporaryTenants: Ref<AzureAccessibleTenant[]>
  temporaryWorkspaces: Ref<AzureAccessibleWorkspace[]>
  temporaryAzureUsername: Ref<string>
  temporaryLogAnalyticsAuthorizing: Ref<boolean>
  temporaryAccessStatus: Ref<TemporaryAccessStatus>
  temporaryAccessError: Ref<string | null>
  temporaryTenantValid: ComputedRef<boolean>
  temporaryWorkspaceValid: ComputedRef<boolean>
  temporaryAdminConsentUrl: ComputedRef<string | null>
  disconnectTemporaryLogAnalytics: () => Promise<void>
  authorizeTemporaryLogAnalytics: () => Promise<void>
  connectTemporaryLogAnalytics: () => Promise<void>
  changeTemporaryTenant: (tenantId: string) => void
  changeTemporaryWorkspace: (workspaceId: string) => void
  refreshTemporaryAzureAccess: () => void
}

function mergeCurrentTenant(tenants: AzureAccessibleTenant[], tenantId: string) {
  if (tenants.some((tenant) => tenant.tenantId === tenantId)) {
    return tenants
  }
  return [...tenants, { defaultDomain: null, displayName: tenantId, tenantId }]
}

export function useTemporaryLogAnalyticsWorkspace(options: {
  onWorkspaceChange: () => void
}): UseTemporaryLogAnalyticsWorkspaceReturn {
  const runtimeConfig = useRuntimeConfig()
  const temporaryLogAnalyticsAuth = useTemporaryLogAnalyticsAuth()
  const temporaryLogAnalyticsClient = createTemporaryLogAnalyticsClient({
    getLogAnalyticsAccessToken: temporaryLogAnalyticsAuth.getAccessToken,
    getManagementAccessToken: temporaryLogAnalyticsAuth.getManagementAccessToken,
  })
  const temporaryTenantId = ref('')
  const temporaryWorkspaceId = ref('')
  const temporaryTenants = ref<AzureAccessibleTenant[]>([])
  const temporaryWorkspaces = ref<AzureAccessibleWorkspace[]>([])
  const temporaryAzureUsername = ref('')
  const temporaryLogAnalyticsAuthorizing = ref(false)
  const temporaryAccessStatus = ref<TemporaryAccessStatus>('idle')
  const temporaryAccessError = ref<string | null>(null)
  let temporaryAccessGeneration = 0
  let temporaryAuthorizationGeneration = 0
  let temporaryAccessController: AbortController | null = null
  onScopeDispose(() => {
    temporaryAccessController?.abort()
    temporaryAccessController = null
  })
  const temporaryTenantValid = computed(() => isEntraId(temporaryTenantId.value))
  const temporaryWorkspaceValid = computed(() => isEntraId(temporaryWorkspaceId.value))
  const temporaryAdminConsentUrl = computed(() =>
    import.meta.client
      ? createLogAnalyticsAdminConsentUrl(
          temporaryTenantId.value,
          runtimeConfig.public.logAnalyticsDelegated.clientId,
          globalThis.location.origin,
        )
      : null,
  )
  async function disconnectTemporaryLogAnalytics() {
    temporaryAccessGeneration += 1
    temporaryAccessController?.abort()
    temporaryAccessController = null
    temporaryAuthorizationGeneration += 1
    temporaryLogAnalyticsAuthorizing.value = false
    options.onWorkspaceChange()
    temporaryTenantId.value = ''
    temporaryWorkspaceId.value = ''
    temporaryTenants.value = []
    temporaryWorkspaces.value = []
    temporaryAzureUsername.value = ''
    temporaryAccessStatus.value = 'idle'
    temporaryAccessError.value = null
    await temporaryLogAnalyticsAuth.disconnect()
  }

  async function authorizeTemporaryLogAnalytics() {
    if (!temporaryTenantValid.value || temporaryLogAnalyticsAuthorizing.value) {
      return
    }
    const generation = temporaryAuthorizationGeneration
    const tenantId = temporaryTenantId.value.trim()
    temporaryLogAnalyticsAuthorizing.value = true
    try {
      await temporaryLogAnalyticsAuth.getAccessToken(tenantId, true)
    } catch {
      if (
        generation !== temporaryAuthorizationGeneration ||
        tenantId !== temporaryTenantId.value.trim()
      ) {
        return
      }
      return
    } finally {
      if (generation === temporaryAuthorizationGeneration) {
        temporaryLogAnalyticsAuthorizing.value = false
      }
    }
    refreshTemporaryAzureAccess()
  }

  async function checkTemporaryLogAnalyticsAuthorization() {
    const generation = ++temporaryAuthorizationGeneration
    const tenantId = temporaryTenantId.value.trim()
    temporaryLogAnalyticsAuth.invalidateAuthorization()
    if (!temporaryLogAnalyticsAuth.connected.value || !isEntraId(tenantId)) {
      temporaryLogAnalyticsAuthorizing.value = false
      return false
    }
    temporaryLogAnalyticsAuthorizing.value = true
    const authorized = await temporaryLogAnalyticsAuth.checkAuthorization(tenantId)
    if (generation === temporaryAuthorizationGeneration) {
      temporaryLogAnalyticsAuthorizing.value = false
    }
    return authorized
  }

  function selectTemporaryWorkspace(workspaceId: string) {
    if (workspaceId === temporaryWorkspaceId.value) {
      return
    }
    options.onWorkspaceChange()
    temporaryWorkspaceId.value = workspaceId
  }

  async function discoverTemporaryAzureAccess(tenantId: string) {
    temporaryAccessController?.abort()
    const controller = new AbortController()
    temporaryAccessController = controller
    const generation = ++temporaryAccessGeneration
    temporaryTenantId.value = tenantId
    selectTemporaryWorkspace('')
    temporaryWorkspaces.value = []
    temporaryAccessStatus.value = 'loading'
    temporaryAccessError.value = null
    try {
      const authorized = await checkTemporaryLogAnalyticsAuthorization()
      const access = await temporaryLogAnalyticsClient.discover(tenantId, controller.signal)
      if (generation !== temporaryAccessGeneration || temporaryTenantId.value !== tenantId) {
        return
      }
      temporaryTenants.value = mergeCurrentTenant(access.tenants, tenantId)
      temporaryWorkspaces.value = authorized ? access.workspaces : []
      if (authorized && access.workspaces.length === 1) {
        selectTemporaryWorkspace(access.workspaces[0]?.workspaceId ?? '')
      }
      temporaryAccessStatus.value = 'success'
    } catch (error: unknown) {
      if (
        generation !== temporaryAccessGeneration ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        return
      }
      temporaryAccessStatus.value = 'error'
      temporaryAccessError.value =
        error instanceof Error
          ? error.message
          : 'Could not discover Azure directories and workspaces.'
    } finally {
      if (generation === temporaryAccessGeneration) {
        temporaryAccessController = null
      }
    }
  }

  async function connectTemporaryLogAnalytics() {
    const connection = await temporaryLogAnalyticsAuth.connect()
    if (!connection) {
      return
    }
    temporaryAzureUsername.value = connection.username
    await discoverTemporaryAzureAccess(connection.tenantId)
  }

  function changeTemporaryTenant(tenantId: string) {
    if (!isEntraId(tenantId) || tenantId === temporaryTenantId.value) {
      return
    }
    void discoverTemporaryAzureAccess(tenantId)
  }

  function changeTemporaryWorkspace(workspaceId: string) {
    if (isEntraId(workspaceId)) {
      selectTemporaryWorkspace(workspaceId)
    }
  }

  function refreshTemporaryAzureAccess() {
    if (!temporaryTenantValid.value) {
      return
    }
    void discoverTemporaryAzureAccess(temporaryTenantId.value)
  }

  return {
    temporaryLogAnalyticsAuth,
    temporaryLogAnalyticsClient,
    temporaryTenantId,
    temporaryWorkspaceId,
    temporaryTenants,
    temporaryWorkspaces,
    temporaryAzureUsername,
    temporaryLogAnalyticsAuthorizing,
    temporaryAccessStatus,
    temporaryAccessError,
    temporaryTenantValid,
    temporaryWorkspaceValid,
    temporaryAdminConsentUrl,
    disconnectTemporaryLogAnalytics,
    authorizeTemporaryLogAnalytics,
    connectTemporaryLogAnalytics,
    changeTemporaryTenant,
    changeTemporaryWorkspace,
    refreshTemporaryAzureAccess,
  }
}
