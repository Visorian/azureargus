<script setup lang="ts">
import {
  EVENT_HUB_LOOKBACK_OPTIONS,
  type EventHubConnectionForm,
} from "~/composables/useEventHubConnection";

defineProps<{
  clearingLogHistory: boolean;
  connecting: boolean;
  connectionStringPersistenceError: string | null;
  logHistoryEnabled: boolean;
  logHistoryError: string | null;
  managed: boolean;
  modeTransitioning: boolean;
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

    <UForm :state="connectionForm" class="space-y-3" @submit="emit('connect')">
      <UFormField label="Connection string" name="connectionString" :required="!managed">
        <UTextarea
          v-model="connectionString"
          :rows="4"
          class="w-full"
          :disabled="managed"
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
        <UInput v-model="consumerGroup" class="w-full" />
      </UFormField>
      <UFormField label="Event Hub name" name="eventHubName">
        <UInput
          v-model="eventHubName"
          class="w-full"
          :disabled="managed"
          :placeholder="managed ? 'Configured by deployment' : 'Only needed without EntityPath'"
        />
      </UFormField>
      <UFormField label="Lookback" name="lookbackMinutes">
        <USelect v-model="lookbackMinutes" :items="EVENT_HUB_LOOKBACK_OPTIONS" class="w-full" />
      </UFormField>
      <UFormField label="Visible rows" name="bufferSize">
        <UInput v-model.number="bufferSize" type="number" min="100" step="100" class="w-full" />
      </UFormField>
      <div class="flex gap-2">
        <UButton
          type="submit"
          color="primary"
          variant="solid"
          icon="i-lucide-radio-receiver"
          label="Connect"
          :disabled="modeTransitioning"
          :loading="connecting"
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
