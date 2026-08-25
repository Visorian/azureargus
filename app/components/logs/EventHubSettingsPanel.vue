<script setup lang="ts">
import {
  EVENT_HUB_LOOKBACK_OPTIONS,
  type EventHubConnectionForm,
} from "~/composables/useEventHubConnection";

const DEPLOY_EVENT_HUB_URL =
  "https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy-event-hub-only.json";
const DEPLOY_EVENT_HUB_WITH_DIAGNOSTICS_URL =
  "https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FVisorian%2Fazureargus%2Fmain%2Finfrastructure%2Fevent-hub%2Fazuredeploy.json";

const props = defineProps<{
  clearingLogHistory: boolean;
  connectionActive: boolean;
  connecting: boolean;
  connectionStringPersistenceError: string | null;
  logHistoryEnabled: boolean;
  logHistoryError: string | null;
  managed: boolean;
  modeTransitioning: boolean;
  reconnecting: boolean;
}>();

const emit = defineEmits<{
  connect: [];
  disconnect: [];
  updateLogRetention: [enabled: boolean];
}>();

const connectionForm = defineModel<EventHubConnectionForm>("connectionForm", { required: true });
const rememberConnectionString = defineModel<boolean>("rememberConnectionString", {
  required: true,
});

function createConnectionFieldModel<Key extends keyof EventHubConnectionForm>(key: Key) {
  return computed<EventHubConnectionForm[Key]>({
    get: () => connectionForm.value[key],
    set: (value) => {
      connectionForm.value = { ...connectionForm.value, [key]: value };
    },
  });
}

const connectionString = createConnectionFieldModel("connectionString");
const consumerGroup = createConnectionFieldModel("consumerGroup");
const eventHubName = createConnectionFieldModel("eventHubName");
const lookbackMinutes = createConnectionFieldModel("lookbackMinutes");
const bufferSize = createConnectionFieldModel("bufferSize");
const connectionFieldsDisabled = computed(
  () => props.connecting || props.reconnecting || props.connectionActive,
);
</script>

<template>
  <div class="space-y-3">
    <div>
      <h2 class="text-sm font-semibold">Live Event Hub settings</h2>
      <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
        {{
          managed
            ? "Connection is configured by deployment."
            : "Use a Listen-only SAS policy. Credentials stay in memory unless remembered."
        }}
      </p>
    </div>

    <UAlert
      v-if="reconnecting"
      color="info"
      variant="subtle"
      icon="i-lucide-refresh-cw"
      title="Reconnecting to Event Hub"
      description="Retrying automatically from the latest received position."
      role="status"
    />

    <div
      v-if="!managed"
      class="rounded-md border border-brand-gray-200 bg-brand-gray-50 p-3 dark:border-brand-gray-800 dark:bg-brand-gray-900"
    >
      <p class="text-xs font-semibold">Need an Event Hub?</p>
      <p class="mt-1 text-xs text-brand-gray-600 dark:text-brand-gray-300">
        Deploy an Event Hub by itself or include Azure Firewall diagnostic forwarding. Then copy
        event-hub-level
        <code class="font-mono">azureargus-listen</code> primary connection string containing
        <code class="font-mono">EntityPath</code>.
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <UButton
          :to="DEPLOY_EVENT_HUB_URL"
          target="_blank"
          rel="noopener noreferrer"
          color="neutral"
          variant="outline"
          size="sm"
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
          size="sm"
          icon="i-lucide-external-link"
          label="Event Hub + firewall diagnostics"
          aria-label="Deploy Event Hub and firewall diagnostics to Azure (opens in new tab)"
        />
      </div>
    </div>

    <UForm :state="connectionForm" class="space-y-3" @submit="emit('connect')">
      <UFormField label="Connection string" name="connectionString" :required="!managed">
        <UTextarea
          v-model="connectionString"
          :rows="4"
          class="w-full"
          :disabled="managed || connectionFieldsDisabled"
          :placeholder="
            managed
              ? 'Configured by deployment'
              : 'Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=...'
          "
        />
      </UFormField>
      <UCheckbox
        v-if="!managed"
        v-model="rememberConnectionString"
        label="Remember connection string"
        description="Stores this SAS credential unencrypted in browser storage. Avoid shared devices."
      />
      <p
        v-if="!managed && connectionStringPersistenceError"
        role="alert"
        class="text-xs text-red-600 dark:text-red-400"
      >
        {{ connectionStringPersistenceError }}
      </p>
      <UFormField label="Consumer group" name="consumerGroup" required>
        <UInput v-model="consumerGroup" class="w-full" :disabled="connectionFieldsDisabled" />
      </UFormField>
      <UFormField label="Event Hub name" name="eventHubName">
        <UInput
          v-model="eventHubName"
          class="w-full"
          :disabled="managed || connectionFieldsDisabled"
          :placeholder="managed ? 'Configured by deployment' : 'Only needed without EntityPath'"
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
      <UFormField label="Visible rows" name="bufferSize">
        <UInput
          v-model.number="bufferSize"
          type="number"
          min="100"
          step="100"
          class="w-full"
          :disabled="connectionFieldsDisabled"
        />
      </UFormField>
      <div class="flex gap-2">
        <UButton
          type="submit"
          color="primary"
          variant="solid"
          icon="i-lucide-radio-receiver"
          label="Connect"
          :disabled="modeTransitioning"
          :loading="connecting || reconnecting"
        />
        <UButton
          variant="outline"
          color="neutral"
          icon="i-lucide-unplug"
          label="Disconnect"
          @click="emit('disconnect')"
        />
      </div>
    </UForm>

    <div class="border-t border-brand-gray-200 pt-3 dark:border-brand-gray-800">
      <div class="flex items-center gap-1">
        <USwitch
          label="Local log retention"
          :model-value="logHistoryEnabled"
          :disabled="clearingLogHistory"
          :loading="clearingLogHistory"
          @update:model-value="emit('updateLogRetention', $event)"
        />
        <UTooltip :content="{ side: 'bottom' }" :ui="{ content: 'h-auto max-w-72 p-3' }">
          <UButton
            icon="i-lucide-info"
            aria-label="About local log retention"
            color="neutral"
            variant="ghost"
            size="xs"
            square
          />
          <template #content>
            <p class="text-xs leading-5 whitespace-normal">
              Keeps up to 100,000 parsed Live Event Hub records in this browser for up to 24 hours.
              Raw payloads are excluded. Turning retention off or starting a new session clears
              saved records.
            </p>
          </template>
        </UTooltip>
      </div>
      <p v-if="logHistoryError" role="alert" class="mt-2 text-xs text-red-600 dark:text-red-400">
        {{ logHistoryError }}
      </p>
    </div>
  </div>
</template>
