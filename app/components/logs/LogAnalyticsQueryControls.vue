<script setup lang="ts">
import type { LogAnalyticsQueryStatus } from '~/composables/useLogAnalyticsQuery'
import type { LogHourCycle } from '~/composables/useLogTimeFormat'
import type { LogAnalysisDateRange } from '~/utils/logAnalysis'
import { parseLogAnalysisDateRange } from '~/utils/logAnalysis'

const draftRange = defineModel<LogAnalysisDateRange>('draftRange', { required: true })

const props = withDefaults(
  defineProps<{
    showRun?: boolean
    displayTimeZone: string
    hourCycle: LogHourCycle
    appliedRangeLabel: string
    canRun: boolean
    queryStatus: LogAnalyticsQueryStatus | 'idle' | 'loading' | 'success' | 'error'
    rangeDirty: boolean
    rangeError: string | null
    resultsTruncated: boolean
  }>(),
  { showRun: true },
)

const emit = defineEmits<{
  run: []
}>()

const inputTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const convertedRangeLabel = computed(() => {
  const range = parseLogAnalysisDateRange(draftRange.value)
  if (!range.ok) {
    return ''
  }
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: props.displayTimeZone,
    hourCycle: props.hourCycle,
  })
  return formatter.formatRange(new Date(range.value.from), new Date(range.value.to))
})
const queryLoading = computed(
  () => props.queryStatus === 'loading' || props.queryStatus === 'refreshing',
)

const draftFrom = computed({
  get: () => draftRange.value.from,
  set: (from: string) => {
    draftRange.value = { ...draftRange.value, from }
  },
})
const draftTo = computed({
  get: () => draftRange.value.to,
  set: (to: string) => {
    draftRange.value = { ...draftRange.value, to }
  },
})
</script>

<template>
  <div class="min-w-0 flex-1 space-y-2">
    <UForm :state="draftRange" class="flex flex-wrap items-end gap-2" @submit="emit('run')">
      <UFormField label="Start" name="from" required class="w-full min-w-0 sm:w-60">
        <UInput v-model="draftFrom" type="datetime-local" class="w-full" />
      </UFormField>
      <UFormField label="End" name="to" required class="w-full min-w-0 sm:w-60">
        <UInput v-model="draftTo" type="datetime-local" class="w-full" />
      </UFormField>
      <UButton
        v-if="showRun"
        type="submit"
        icon="i-lucide-search"
        label="Run query"
        class="touch-control"
        :disabled="!canRun"
        :loading="queryStatus === 'loading'"
      />
    </UForm>
    <p class="text-xs text-muted">Enter times in {{ inputTimeZone }}.</p>
    <p v-if="convertedRangeLabel" class="text-xs text-muted" data-testid="converted-query-range">
      Query in {{ displayTimeZone }}: {{ convertedRangeLabel }}.
    </p>

    <p v-if="rangeError" role="alert" class="text-xs text-red-600 dark:text-red-400">
      {{ rangeError }}
    </p>
    <p v-else-if="rangeDirty && !queryLoading" class="text-xs text-amber-700 dark:text-amber-300">
      Run query to apply date range. Results still show {{ appliedRangeLabel }}.
    </p>
    <p v-if="resultsTruncated" class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
      Result limit reached. Narrow filters or time range for complete results.
    </p>
  </div>
</template>
