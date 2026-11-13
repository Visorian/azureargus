<script setup lang="ts">
import type { LogAnalyticsStorageKind } from '#shared/types/logAnalytics'
import {
  DEFAULT_LOG_ANALYTICS_QUERY_LIMIT,
  isLogAnalyticsQueryLimit,
  MAX_LOG_ANALYTICS_QUERY_LIMIT,
  MIN_LOG_ANALYTICS_QUERY_LIMIT,
} from '#shared/utils/logAnalytics'
import type { LogAnalyticsSettingsState } from '~/composables/useLogAnalyticsSettings'
import { LOG_ANALYTICS_WORKSPACES_URL } from '~/utils/logAnalyticsOnboarding'

const tenantId = defineModel<string>('tenantId', { required: true })
const workspaceId = defineModel<string>('workspaceId', { required: true })
const queryLimit = defineModel<number>('queryLimit', { required: true })
const queryStorage = defineModel<LogAnalyticsStorageKind>('queryStorage', { required: true })

const props = defineProps<
  LogAnalyticsSettingsState & {
    adminConsentUrl: string | null
    lens: 'all-logs' | 'dns-troubleshooting'
    temporary: boolean
    temporaryAccessError: string | null
    temporaryLogAnalyticsAuthorizing: boolean
    temporaryAuthError: string | null
    temporaryAzureUsername: string
  }
>()
const emit = defineEmits<{
  changeTenant: [tenantId: string]
  changeWorkspace: [workspaceId: string]
  connectAzure: []
  disconnectAzure: []
  authorizeLogAnalytics: []
  refreshAzureAccess: []
  refreshReadiness: []
}>()
const connectActions = useTemplateRef<HTMLElement>('connectActions')
const directoryStep = useTemplateRef('directoryStep')
const {
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
} = useLogAnalyticsSettings(props, tenantId, workspaceId, connectActions)
const queryStorageItems: { label: string; value: LogAnalyticsStorageKind }[] = [
  { label: 'Dedicated tables', value: 'resource-specific' },
  { label: 'AzureDiagnostics', value: 'azure-diagnostics' },
]
const queryLimitValue = computed({
  get: () => queryLimit.value,
  set: (value: number | undefined) => {
    queryLimit.value = isLogAnalyticsQueryLimit(value) ? value : DEFAULT_LOG_ANALYTICS_QUERY_LIMIT
  },
})
const connectBlocked = computed(
  () => props.temporaryAuthStatus === 'connecting' || props.temporaryAuthStatus === 'connected',
)
const consentBlocked = computed(() => !tenantValid.value || props.temporaryLogAnalyticsAuthorizing)
const discoveryBlocked = computed(
  () => !tenantValid.value || props.temporaryAccessStatus === 'loading',
)
const workspaceRefreshBlocked = computed(
  () => discoveryBlocked.value || !props.temporaryLogAnalyticsAuthorized,
)

function changeTenant(value: unknown) {
  if (typeof value === 'string' && value !== tenantId.value) {
    emit('changeTenant', value)
  }
}
function changeWorkspace(value: unknown) {
  if (typeof value === 'string' && value !== workspaceId.value) {
    emit('changeWorkspace', value)
  }
}

function connectAzure() {
  if (!connectBlocked.value) {
    emit('connectAzure')
  }
}

function disconnectAzure() {
  if (props.temporaryAuthStatus === 'connected') {
    emit('disconnectAzure')
  }
}

function refreshConsent() {
  if (!consentBlocked.value) {
    emit('authorizeLogAnalytics')
  }
}

function refreshWorkspace() {
  if (!workspaceRefreshBlocked.value) {
    emit('refreshAzureAccess')
  }
}

async function retryDiscovery(event: MouseEvent) {
  if (discoveryBlocked.value) {
    return
  }
  const trigger = event.currentTarget
  emit('refreshAzureAccess')
  await nextTick()
  if (trigger instanceof HTMLElement && !trigger.isConnected) {
    directoryStep.value?.focus()
  }
}

function checkReadiness() {
  if (props.dnsReadinessStatus !== 'loading') {
    emit('refreshReadiness')
  }
}

function guardConsent(event: MouseEvent) {
  if (props.adminConsentUrl === null) {
    event.preventDefault()
  }
}
</script>

<template>
  <LogsSettingsSection
    title="Log Analytics settings"
    :description="
      lens === 'dns-troubleshooting'
        ? 'Query DNS diagnostics in configured Azure Firewall workspace.'
        : 'Query configured Azure Firewall workspace.'
    "
  >
    <div v-if="temporary" class="space-y-4">
      <p class="settings-description">
        Sign in once to discover accessible Azure directories and workspaces. The session stays in
        browser memory.
      </p>
      <ol aria-label="Temporary Log Analytics setup">
        <LogsSettingsStep
          :number="1"
          title="Connect Azure account"
          description="Use a work or school account to discover available directories."
        >
          <div ref="connectActions" class="settings-actions">
            <UButton
              :color="temporaryAuthStatus === 'connected' ? 'neutral' : 'primary'"
              :variant="temporaryAuthStatus === 'connected' ? 'outline' : 'solid'"
              :icon="
                temporaryAuthStatus === 'connecting' ? 'i-lucide-loader-circle' : 'i-lucide-log-in'
              "
              label="Connect to Azure"
              :aria-busy="temporaryAuthStatus === 'connecting'"
              :aria-disabled="connectBlocked"
              @click="connectAzure"
            />
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-unplug"
              label="Disconnect"
              :aria-disabled="temporaryAuthStatus !== 'connected'"
              @click="disconnectAzure"
            />
          </div>
          <AppStatusLabel
            v-if="temporaryAuthStatus === 'connected'"
            role="status"
            tone="success"
            :label="`Connected${temporaryAzureUsername ? ` as ${temporaryAzureUsername}` : ''}.`"
          />
          <AppNotice
            v-if="temporaryAuthError && temporaryAuthStatus !== 'connected'"
            tone="error"
            title="Azure sign-in failed"
            :description="temporaryAuthError"
          />
        </LogsSettingsStep>

        <LogsSettingsStep
          v-if="temporaryAuthStatus === 'connected'"
          ref="directoryStep"
          :number="2"
          title="Choose Azure directory and grant consent"
          description="A tenant admin must approve Log Analytics access before workspace selection."
        >
          <UFormField label="Directory" name="tenantId">
            <USelectMenu
              :model-value="selectedTenant"
              :items="tenantItems"
              value-key="tenantId"
              label-key="label"
              class="w-full"
              :loading="temporaryAccessStatus === 'loading'"
              :disabled="temporaryAccessStatus === 'loading' || tenantItems.length === 0"
              :placeholder="directoryPlaceholder"
              @update:model-value="changeTenant"
            />
          </UFormField>
          <p v-if="tenantValid && tenantItems.length > 0" class="settings-identifier">
            {{ tenantId }}
          </p>
          <div class="settings-actions">
            <UButton
              :to="adminConsentUrl ?? undefined"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="outline"
              icon="i-lucide-shield-check"
              label="Grant tenant consent"
              :aria-disabled="adminConsentUrl === null"
              @click="guardConsent"
            />
            <UButton
              color="neutral"
              variant="outline"
              :icon="
                temporaryLogAnalyticsAuthorizing ? 'i-lucide-loader-circle' : 'i-lucide-refresh-cw'
              "
              label="Refresh consent"
              :aria-busy="temporaryLogAnalyticsAuthorizing"
              :aria-disabled="consentBlocked"
              @click="refreshConsent"
            />
          </div>
          <AppStatusLabel
            v-if="temporaryLogAnalyticsAuthorized && !temporaryAuthError"
            role="status"
            tone="success"
            label="Log Analytics access available for selected directory."
          />
          <AppNotice
            v-if="temporaryAuthError"
            tone="error"
            title="Log Analytics authorization failed"
            :description="temporaryAuthError"
          />
          <AppNotice
            v-if="temporaryAccessError && tenantItems.length === 0"
            tone="error"
            title="Directory discovery failed"
            :description="temporaryAccessError"
          >
            <template #actions>
              <UButton
                color="neutral"
                variant="outline"
                label="Try again"
                :aria-disabled="discoveryBlocked"
                :aria-busy="temporaryAccessStatus === 'loading'"
                @click="retryDiscovery"
              />
            </template>
          </AppNotice>
        </LogsSettingsStep>

        <LogsSettingsStep
          v-if="temporaryAuthStatus === 'connected'"
          :number="3"
          title="Select accessible workspace"
          description="Missing workspace access requires Log Analytics Data Reader at workspace scope."
        >
          <UFormField label="Workspace" name="workspaceId">
            <USelectMenu
              :model-value="selectedWorkspace"
              :items="workspaceItems"
              value-key="workspaceId"
              label-key="label"
              class="w-full"
              :loading="temporaryAccessStatus === 'loading'"
              :disabled="
                !temporaryLogAnalyticsAuthorized ||
                temporaryAccessStatus === 'loading' ||
                workspaceItems.length === 0
              "
              :placeholder="workspacePlaceholder"
              @update:model-value="changeWorkspace"
            />
          </UFormField>
          <p v-if="workspaceValid && workspaceItems.length > 0" class="settings-identifier">
            {{ workspaceId }}
          </p>
          <div class="settings-actions">
            <UButton
              color="neutral"
              variant="outline"
              :icon="
                temporaryAccessStatus === 'loading'
                  ? 'i-lucide-loader-circle'
                  : 'i-lucide-refresh-cw'
              "
              label="Refresh"
              :aria-busy="temporaryAccessStatus === 'loading'"
              :aria-disabled="workspaceRefreshBlocked"
              @click="refreshWorkspace"
            />
            <UButton
              :to="tenantValid ? LOG_ANALYTICS_WORKSPACES_URL : undefined"
              target="_blank"
              rel="noopener noreferrer"
              color="neutral"
              variant="outline"
              icon="i-lucide-external-link"
              label="Permissions"
              :disabled="!tenantValid || !temporaryLogAnalyticsAuthorized"
            />
          </div>
          <AppNotice
            v-if="temporaryAccessError && tenantItems.length > 0"
            tone="error"
            title="Workspace discovery failed"
            :description="temporaryAccessError"
          />
          <AppStatusLabel
            v-else-if="
              temporaryLogAnalyticsAuthorized &&
              temporaryAccessStatus === 'success' &&
              workspaceItems.length === 0
            "
            role="status"
            tone="warning"
            label="No accessible Log Analytics workspace found in selected directory."
          />
          <AppStatusLabel
            v-else-if="!temporaryLogAnalyticsAuthorized"
            role="status"
            tone="warning"
            label="Grant tenant consent before selecting a workspace."
          />
        </LogsSettingsStep>
      </ol>
    </div>

    <UFormField
      label="Query result limit"
      name="queryLimit"
      hint="100–5,000"
      description="Caps All logs rows and each DNS result list. Applies to next query."
    >
      <UInputNumber
        v-model="queryLimitValue"
        :min="MIN_LOG_ANALYTICS_QUERY_LIMIT"
        :max="MAX_LOG_ANALYTICS_QUERY_LIMIT"
        :step="100"
        class="w-full"
      />
    </UFormField>

    <section
      v-if="!temporary || workspaceValid"
      class="settings-section-divider settings-readiness"
      aria-labelledby="dns-readiness-heading"
    >
      <h4 id="dns-readiness-heading" class="settings-step-title">Source readiness</h4>
      <UButton
        color="neutral"
        variant="outline"
        :icon="dnsReadinessStatus === 'loading' ? 'i-lucide-loader-circle' : 'i-lucide-refresh-cw'"
        label="Check again"
        :aria-busy="dnsReadinessStatus === 'loading'"
        :aria-disabled="dnsReadinessStatus === 'loading'"
        @click="checkReadiness"
      />
      <AppStatusLabel
        v-if="dnsReadinessStatus === 'success'"
        role="status"
        :tone="readinessSummary.tone"
        :label="readinessSummary.label"
      />
      <AppStatusLabel
        v-else-if="dnsReadinessStatus === 'loading'"
        role="status"
        tone="primary"
        icon="i-lucide-loader-circle"
        label="Checking selected workspace…"
      />
      <AppNotice
        v-else-if="dnsReadinessStatus === 'error'"
        tone="error"
        title="Source readiness check failed"
        description="Check the workspace permissions and try again."
      />
      <p v-else class="settings-description">Waiting for workspace check.</p>
      <UFormField label="Query source" name="queryStorage">
        <USelect
          id="query-storage"
          v-model="queryStorage"
          :items="queryStorageItems"
          :disabled="!queryStorageSelectionEnabled"
          class="w-full"
        />
      </UFormField>
      <LogsSourceReadinessTable :readiness="dnsReadiness" :status="dnsReadinessStatus" />
    </section>
  </LogsSettingsSection>
</template>
