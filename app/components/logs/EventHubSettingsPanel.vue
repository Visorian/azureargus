<script setup lang="ts">
import { EVENT_HUB_LOOKBACK_OPTIONS, validateEventHubFields } from '~/utils/eventHubConnection'
import type { EventHubConnectionForm } from '~/utils/eventHubConnection'

const connectionForm = defineModel<EventHubConnectionForm>('connectionForm', { required: true })
const rememberConnectionString = defineModel<boolean>('rememberConnectionString', {
  required: true,
})
const props = withDefaults(
  defineProps<{
    clearingLogHistory: boolean
    connectionActive: boolean
    connecting: boolean
    connectionError?: string | null
    connectionStringPersistenceError: string | null
    logHistoryEnabled: boolean
    logHistoryError: string | null
    managed: boolean
    modeTransitioning: boolean
    reconnecting: boolean
    savedLogCount?: number
  }>(),
  { connectionError: null, savedLogCount: 0 },
)
const emit = defineEmits<{
  connect: []
  disconnect: []
  updateLogRetention: [enabled: boolean]
}>()
const DEPLOY_EVENT_HUB_URL =
  'https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy-event-hub-only.json'
const DEPLOY_EVENT_HUB_WITH_DIAGNOSTICS_URL =
  'https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy.json'
const confirmClearHistory = ref(false)
const form = useTemplateRef('connectionSettingsForm')
const validation = useEventHubSettingsValidation({
  connectionForm,
  async revalidate() {
    await form.value?.validate({
      silent: true,
      nested: false,
    })
    return form.value?.getErrors() ?? []
  },
})

function createConnectionFieldModel<Key extends keyof EventHubConnectionForm>(key: Key) {
  return computed<EventHubConnectionForm[Key]>({
    get: () => connectionForm.value[key],
    set: (value) => {
      connectionForm.value = { ...connectionForm.value, [key]: value }
    },
  })
}

const connectionString = createConnectionFieldModel('connectionString')
const consumerGroup = createConnectionFieldModel('consumerGroup')
const eventHubName = createConnectionFieldModel('eventHubName')
const lookbackMinutes = createConnectionFieldModel('lookbackMinutes')
const bufferSize = createConnectionFieldModel('bufferSize')
const connectionFieldsDisabled = computed(
  () => props.connecting || props.reconnecting || props.connectionActive,
)
const connectBlocked = computed(() => props.modeTransitioning || connectionFieldsDisabled.value)
const disconnectBlocked = computed(
  () =>
    props.modeTransitioning ||
    (!props.connectionActive && !props.reconnecting && !props.connecting),
)

function validateConnection(state: EventHubConnectionForm) {
  return validateEventHubFields(state, props.managed)
}

function submitConnection() {
  if (connectBlocked.value) {
    return
  }
  validation.clear()
  emit('connect')
}

function guardConnect(event: MouseEvent) {
  if (connectBlocked.value) {
    event.preventDefault()
  }
}

function disconnect() {
  if (!disconnectBlocked.value) {
    emit('disconnect')
  }
}

function updateRetention(enabled: boolean) {
  if (!enabled && props.savedLogCount > 0) {
    confirmClearHistory.value = true
    return
  }
  emit('updateLogRetention', enabled)
}
</script>

<template>
  <LogsSettingsSection
    title="Live Event Hub settings"
    :description="
      managed
        ? 'Connection is configured by deployment.'
        : 'Use a Listen-only SAS policy. Credentials stay in memory unless remembered.'
    "
  >
    <AppStatusLabel
      v-if="connectionActive && !reconnecting"
      tone="success"
      label="Connected to Event Hub."
      role="status"
    />
    <AppNotice
      v-if="reconnecting"
      tone="primary"
      title="Reconnecting to Event Hub"
      description="Retrying automatically from the latest received position."
    />

    <div v-if="!managed" class="settings-summary">
      <h4 class="settings-step-title">Need an Event Hub?</h4>
      <p class="settings-description">
        Deploy an Event Hub with optional Azure Firewall diagnostic forwarding. Copy the
        event-hub-level <code>azureargus-listen</code> connection string containing
        <code>EntityPath</code>.
      </p>
      <div class="settings-actions settings-deploy-actions">
        <UButton
          :to="DEPLOY_EVENT_HUB_URL"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          label="Event Hub only"
          aria-label="Deploy Event Hub only to Azure (opens in new tab)"
        />
        <UButton
          :to="DEPLOY_EVENT_HUB_WITH_DIAGNOSTICS_URL"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
          icon="i-lucide-external-link"
          label="Event Hub + firewall diagnostics"
          aria-label="Deploy Event Hub and firewall diagnostics to Azure (opens in new tab)"
        />
      </div>
    </div>

    <UForm
      ref="connectionSettingsForm"
      :state="connectionForm"
      :validate="validateConnection"
      :loading-auto="false"
      class="space-y-3"
      @submit="submitConnection"
      @error="validation.onError"
    >
      <p v-if="validation.message.value" role="alert" class="settings-validation-summary">
        {{ validation.message.value }}
      </p>
      <UFormField v-if="!managed" label="Connection string" name="connectionString" required>
        <UTextarea
          v-model="connectionString"
          :rows="4"
          class="w-full font-mono"
          :disabled="connectionFieldsDisabled"
          placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
        />
      </UFormField>
      <UCheckbox
        v-if="!managed"
        v-model="rememberConnectionString"
        label="Remember connection string"
        description="Stores this SAS credential unencrypted in browser storage. Avoid shared devices."
      />
      <AppNotice
        v-if="!managed && connectionStringPersistenceError"
        tone="error"
        title="Credential could not be saved"
        :description="connectionStringPersistenceError"
      />
      <UFormField label="Consumer group" name="consumerGroup" required>
        <UInput
          v-model="consumerGroup"
          class="w-full font-mono"
          :disabled="connectionFieldsDisabled"
        />
      </UFormField>
      <UFormField
        v-if="!managed"
        label="Event Hub name"
        name="eventHubName"
        description="Only needed when the connection string has no EntityPath."
      >
        <UInput
          v-model="eventHubName"
          class="w-full font-mono"
          :disabled="connectionFieldsDisabled"
        />
      </UFormField>
      <UFormField label="Lookback" name="lookbackMinutes">
        <USelect
          v-model="lookbackMinutes"
          :items="EVENT_HUB_LOOKBACK_OPTIONS"
          class="w-full"
          :disabled="connectionFieldsDisabled"
        />
      </UFormField>
      <UFormField
        label="Visible rows"
        name="bufferSize"
        description="Keep at least 100 entries in the visible log buffer."
      >
        <UInputNumber
          v-model="bufferSize"
          :min="100"
          :step="100"
          class="w-full"
          :disabled="connectionFieldsDisabled"
        />
      </UFormField>
      <AppNotice
        v-if="connectionError && !reconnecting"
        tone="error"
        title="Event Hub connection failed"
        :description="connectionError"
      />
      <div class="settings-actions">
        <UButton
          type="submit"
          :color="connectionActive ? 'neutral' : 'primary'"
          :variant="connectionActive ? 'outline' : 'solid'"
          :icon="connecting || reconnecting ? 'i-lucide-loader-circle' : 'i-lucide-radio-receiver'"
          label="Connect"
          :aria-disabled="connectBlocked"
          :aria-busy="connecting || reconnecting"
          @click="guardConnect"
        />
        <UButton
          variant="outline"
          color="neutral"
          icon="i-lucide-unplug"
          label="Disconnect"
          :aria-disabled="disconnectBlocked"
          @click="disconnect"
        />
      </div>
    </UForm>

    <div class="settings-section-divider">
      <USwitch
        label="Local log retention"
        :model-value="logHistoryEnabled"
        :disabled="clearingLogHistory"
        :loading="clearingLogHistory"
        aria-describedby="log-retention-description"
        @update:model-value="updateRetention"
      />
      <p id="log-retention-description" class="settings-description">
        Keeps up to 100,000 parsed Live Event Hub records in this browser for 24 hours. Raw payloads
        are excluded. Turning retention off or starting a new session clears saved records.
      </p>
      <AppNotice
        v-if="logHistoryError"
        tone="error"
        title="Saved logs could not be cleared"
        :description="logHistoryError"
      />
    </div>
    <AppConfirmDialog
      v-model:open="confirmClearHistory"
      title="Turn off local log retention?"
      description="Saved Live Event Hub records will be cleared from this browser. The current live view stays available."
      confirm-label="Turn off and clear saved logs"
      destructive
      @confirm="emit('updateLogRetention', false)"
    />
  </LogsSettingsSection>
</template>
