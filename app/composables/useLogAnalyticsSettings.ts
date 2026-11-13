import type { ComputedRef, Ref } from 'vue'

import type { AzureAccessibleTenant, AzureAccessibleWorkspace } from '#shared/types/azureAccess'
import type { DnsSourceReadiness } from '#shared/types/dns'
import { hasDnsReadinessData } from '#shared/utils/dnsReadiness'
import type { DnsReadinessStatus } from '~/composables/useDnsSourceReadiness'
import { isEntraId } from '~/utils/logAnalyticsOnboarding'
import { getReadinessSummary } from '~/utils/logAnalyticsReadiness'

export interface LogAnalyticsSettingsState {
  dnsReadiness: DnsSourceReadiness[]
  dnsReadinessStatus: DnsReadinessStatus
  temporaryAccessStatus: 'idle' | 'loading' | 'success' | 'error'
  temporaryAuthStatus: 'idle' | 'connecting' | 'connected' | 'error'
  temporaryLogAnalyticsAuthorized: boolean
  tenantOptions: AzureAccessibleTenant[]
  workspaceOptions: AzureAccessibleWorkspace[]
}

interface LogAnalyticsSettingsView {
  tenantValid: ComputedRef<boolean>
  workspaceValid: ComputedRef<boolean>
  tenantItems: ComputedRef<(AzureAccessibleTenant & { label: string })[]>
  workspaceItems: ComputedRef<(AzureAccessibleWorkspace & { label: string })[]>
  selectedTenant: ComputedRef<string | undefined>
  selectedWorkspace: ComputedRef<string | undefined>
  directoryPlaceholder: ComputedRef<string>
  workspacePlaceholder: ComputedRef<string>
  queryStorageSelectionEnabled: ComputedRef<boolean>
  readinessSummary: ComputedRef<ReturnType<typeof getReadinessSummary>>
}

export function useLogAnalyticsSettings(
  state: LogAnalyticsSettingsState,
  tenantId: Ref<string>,
  workspaceId: Ref<string>,
  connectActions: Readonly<Ref<HTMLElement | null>>,
): LogAnalyticsSettingsView {
  const tenantValid = computed(() => isEntraId(tenantId.value))
  const workspaceValid = computed(() => isEntraId(workspaceId.value))
  const tenantItems = computed(() =>
    state.tenantOptions.map((tenant) => ({
      ...tenant,
      label:
        tenant.defaultDomain !== null && tenant.defaultDomain.length > 0
          ? `${tenant.displayName} · ${tenant.defaultDomain}`
          : tenant.displayName,
    })),
  )
  const workspaceItems = computed(() =>
    state.workspaceOptions.map((workspace) => ({
      ...workspace,
      label: `${workspace.name} · ${workspace.subscriptionName}`,
    })),
  )
  const selectedTenant = computed(() =>
    tenantItems.value.some((item) => item.tenantId === tenantId.value) ? tenantId.value : undefined,
  )
  const selectedWorkspace = computed(() =>
    workspaceItems.value.some((item) => item.workspaceId === workspaceId.value)
      ? workspaceId.value
      : undefined,
  )
  const directoryPlaceholder = computed(() => {
    if (state.temporaryAccessStatus === 'loading') {
      return 'Loading Azure directories…'
    }
    if (state.temporaryAccessStatus === 'error' && tenantItems.value.length === 0) {
      return 'Directory discovery failed'
    }
    return tenantItems.value.length === 0 ? 'No Azure directory discovered' : 'Select a directory'
  })
  const workspacePlaceholder = computed(() => {
    if (!state.temporaryLogAnalyticsAuthorized) {
      return 'Grant tenant consent first'
    }
    if (state.temporaryAccessStatus === 'loading') {
      return 'Loading workspaces…'
    }
    if (state.temporaryAccessStatus === 'error') {
      return 'Workspace discovery failed'
    }
    return workspaceItems.value.length > 0
      ? 'Select a workspace'
      : 'No accessible workspace discovered'
  })
  const queryStorageSelectionEnabled = computed(
    () =>
      hasDnsReadinessData(state.dnsReadiness, 'resource-specific') &&
      hasDnsReadinessData(state.dnsReadiness, 'azure-diagnostics'),
  )
  const readinessSummary = computed(() => getReadinessSummary(state.dnsReadiness))

  watch(
    () => state.temporaryAuthStatus,
    async (status, previous) => {
      if (previous === 'connected' && status === 'idle') {
        await nextTick()
        connectActions.value?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    },
  )

  return {
    tenantValid,
    workspaceValid,
    tenantItems,
    workspaceItems,
    selectedTenant,
    selectedWorkspace,
    directoryPlaceholder,
    workspacePlaceholder,
    queryStorageSelectionEnabled,
    readinessSummary,
  }
}
