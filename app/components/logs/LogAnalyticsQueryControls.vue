<script setup lang="ts">
import type { LogAnalyticsQueryStatus } from "~/composables/useLogAnalyticsQuery";
import type { LogAnalysisDateRange } from "~/utils/logAnalysis";

defineProps<{
  appliedRangeLabel: string;
  canRun: boolean;
  queryStatus: LogAnalyticsQueryStatus | "idle" | "loading" | "success" | "error";
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
  <div class="min-w-0 flex-1 space-y-2">
    <UForm :state="draftRange" class="flex flex-wrap items-end gap-2" @submit="emit('run')">
      <UFormField label="Start" name="from" required class="w-60 max-w-full">
        <UInput v-model="draftFrom" type="datetime-local" class="w-full" />
      </UFormField>
      <UFormField label="End" name="to" required class="w-60 max-w-full">
        <UInput v-model="draftTo" type="datetime-local" class="w-full" />
      </UFormField>
      <UButton
        type="submit"
        icon="i-lucide-search"
        label="Run query"
        :disabled="!canRun"
        :loading="queryStatus === 'loading'"
      />
    </UForm>

    <p v-if="rangeError" role="alert" class="text-xs text-red-600 dark:text-red-400">
      {{ rangeError }}
    </p>
    <p v-else-if="rangeDirty" class="text-xs text-amber-700 dark:text-amber-300">
      Run query to apply date range. Results still show {{ appliedRangeLabel }}.
    </p>
    <p v-if="resultsTruncated" class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
      Result limit reached. Narrow filters or time range for complete results.
    </p>
  </div>
</template>
