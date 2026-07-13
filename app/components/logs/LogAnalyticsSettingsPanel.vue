<script setup lang="ts">
import type { LogAnalyticsQueryStatus } from "~/composables/useLogAnalyticsQuery";
import type { LogAnalysisDateRange } from "~/utils/logAnalysis";

defineProps<{
  lens: "all-logs" | "dns-troubleshooting";
  appliedRangeLabel: string;
  canRun: boolean;
  queryStatus: LogAnalyticsQueryStatus | "idle" | "loading" | "success" | "error";
  rangeDirty: boolean;
  rangeError: string | null;
  resultsTruncated: boolean;
  temporary: boolean;
  temporaryAuthError: string | null;
  temporaryAuthStatus: "idle" | "connecting" | "connected" | "error";
}>();

const emit = defineEmits<{
  connectAzure: [];
  disconnectAzure: [];
  run: [];
}>();

const draftRange = defineModel<LogAnalysisDateRange>("draftRange", { required: true });
const workspaceId = defineModel<string>("workspaceId", { required: true });
const draftFrom = computed({
  get: () => draftRange.value.from,
  set: (from: string) => {
    draftRange.value = { ...draftRange.value, from };
  },
});
const draftTo = computed({
  get: () => draftRange.value.to,
  set: (to: string) => {
    draftRange.value = { ...draftRange.value, to };
  },
});
</script>

<template>
  <div class="space-y-3">
    <div>
      <h2 class="text-sm font-semibold">Log Analytics settings</h2>
      <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
        {{
          lens === "dns-troubleshooting"
            ? "Query DNS diagnostics in configured Azure Firewall workspace."
            : "Query configured Azure Firewall workspace."
        }}
      </p>
    </div>

    <div
      v-if="temporary"
      class="space-y-3 border-b border-brand-gray-200 pb-3 dark:border-brand-gray-800"
    >
      <UFormField label="Workspace ID" name="workspaceId" required>
        <UInput
          v-model="workspaceId"
          class="w-full"
          placeholder="00000000-0000-0000-0000-000000000000"
        />
      </UFormField>
      <div class="flex gap-2">
        <UButton
          color="primary"
          variant="solid"
          icon="i-lucide-log-in"
          label="Connect to Azure"
          :loading="temporaryAuthStatus === 'connecting'"
          :disabled="temporaryAuthStatus === 'connected'"
          @click="emit('connectAzure')"
        />
        <UButton
          color="neutral"
          variant="outline"
          icon="i-lucide-unplug"
          label="Disconnect"
          :disabled="temporaryAuthStatus !== 'connected'"
          @click="emit('disconnectAzure')"
        />
      </div>
      <p v-if="temporaryAuthError" role="alert" class="text-xs text-red-600 dark:text-red-400">
        {{ temporaryAuthError }}
      </p>
    </div>

    <UForm :state="draftRange" class="space-y-3" @submit="emit('run')">
      <UFormField label="Start" name="from" required>
        <UInput v-model="draftFrom" type="datetime-local" class="w-full" />
      </UFormField>
      <UFormField label="End" name="to" required>
        <UInput v-model="draftTo" type="datetime-local" class="w-full" />
      </UFormField>
      <UButton
        type="submit"
        color="primary"
        variant="solid"
        icon="i-lucide-search"
        label="Run query"
        :disabled="!canRun"
        :loading="queryStatus === 'loading'"
      />
    </UForm>

    <div
      v-if="lens === 'dns-troubleshooting'"
      class="rounded-md border border-brand-gray-200 p-3 text-xs text-brand-gray-600 dark:border-brand-gray-700 dark:text-brand-gray-300"
    >
      Full flow requires DNS proxy, <code>EnableDnstapLogging</code>,
      <code>AZFWDnsAdditional</code> routed to Log Analytics, Analytics table plan, and query role.
    </div>

    <p v-if="rangeError" role="alert" class="text-xs text-red-600 dark:text-red-400">
      {{ rangeError }}
    </p>
    <p v-else-if="rangeDirty" class="text-xs text-amber-700 dark:text-amber-300">
      Run query to apply date range. Results still show {{ appliedRangeLabel }}.
    </p>
    <p
      v-if="resultsTruncated"
      class="border-t border-brand-gray-200 pt-3 text-xs text-brand-gray-600 dark:border-brand-gray-800 dark:text-brand-gray-300"
    >
      Result limit reached. Narrow filters or time range for complete results.
    </p>
  </div>
</template>
