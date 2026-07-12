<script setup lang="ts">
import type { LogAnalyticsQueryStatus } from "~/composables/useLogAnalyticsQuery";
import type { LogAnalysisDateRange } from "~/utils/logAnalysis";

defineProps<{
  appliedRangeLabel: string;
  queryStatus: LogAnalyticsQueryStatus;
  rangeDirty: boolean;
  rangeError: string | null;
  resultsTruncated: boolean;
}>();

const emit = defineEmits<{
  run: [];
}>();

const draftRange = defineModel<LogAnalysisDateRange>("draftRange", { required: true });
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
        Query configured Azure Firewall workspace.
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
        :loading="queryStatus === 'loading'"
      />
    </UForm>

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
