<script setup lang="ts">
import { onClickOutside, useMediaQuery } from '@vueuse/core'

import {
  formatLogAnalysisRange,
  createLogAnalysisRangeSizers,
  parseLogAnalysisDateRange,
  resolveLogAnalysisDateRange,
  isLogAnalysisRangePreset,
} from '~/utils/logAnalysis'
import type { LogAnalysisDateRange, LogAnalysisRangePreset } from '~/utils/logAnalysis'

const draftRange = defineModel<LogAnalysisDateRange>('draftRange', { required: true })
const selectedPreset = defineModel<LogAnalysisRangePreset>('preset', { required: true })
const phone = useMediaQuery('(max-width: 640px)')
const panel = useTemplateRef('panel')
const summary = useTemplateRef('summary')
const id = useId()
const error = computed(() => {
  const parsed = parseLogAnalysisDateRange(draftRange.value)
  return parsed.ok ? null : parsed.error
})
const label = computed(() =>
  selectedPreset.value === 'custom'
    ? formatLogAnalysisRange(draftRange.value)
    : `${selectedPreset.value === '60' ? 'Last hour' : `Last ${selectedPreset.value} minutes`} · UTC`,
)
const sizers = createLogAnalysisRangeSizers()
const from = computed({
  get: () => draftRange.value.from,
  set: (value: string) => {
    selectedPreset.value = 'custom'
    draftRange.value = { ...draftRange.value, from: value }
  },
})
const to = computed({
  get: () => draftRange.value.to,
  set: (value: string) => {
    selectedPreset.value = 'custom'
    draftRange.value = { ...draftRange.value, to: value }
  },
})
function preset(value: string) {
  if (!isLogAnalysisRangePreset(value)) {
    return
  }
  selectedPreset.value = value
  if (value === 'custom') {
    return
  }
  draftRange.value = resolveLogAnalysisDateRange(draftRange.value, value)
}
function close(restore = true) {
  if (panel.value) {
    panel.value.open = false
  }
  if (restore) {
    summary.value?.focus({ preventScroll: true })
  }
}
onClickOutside(panel, () => close(false), { ignore: ['[data-reka-popper-content-wrapper]'] })
function leave(event: FocusEvent) {
  if (
    event.relatedTarget instanceof Element &&
    event.relatedTarget.closest('[data-reka-popper-content-wrapper]')
  ) {
    return
  }
  if (
    !phone.value &&
    event.relatedTarget instanceof Node &&
    !panel.value?.contains(event.relatedTarget)
  ) {
    close(false)
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && panel.value?.open) {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}
</script>

<template>
  <details
    ref="panel"
    name="log-filter-popovers"
    class="filter-range"
    @focusout="leave"
    @keydown="keydown"
  >
    <summary ref="summary" class="filter-range-trigger">
      <UIcon name="i-lucide-calendar-range" class="size-4 shrink-0" />
      <span class="filter-range-label">
        <span>{{ label }}</span>
        <span v-for="sizer in sizers" :key="sizer" class="filter-range-sizer" aria-hidden="true">{{
          sizer
        }}</span>
      </span>
      <UIcon name="i-lucide-chevron-down" class="size-4 shrink-0" />
    </summary>
    <div class="filter-popover filter-range-panel">
      <UFormField label="Time range" :name="`${id}-preset`">
        <USelect
          :model-value="selectedPreset"
          :items="[
            { label: 'Last 5 minutes', value: '5' },
            { label: 'Last 15 minutes', value: '15' },
            { label: 'Last 30 minutes', value: '30' },
            { label: 'Last hour', value: '60' },
            { label: 'Custom range', value: 'custom' },
          ]"
          class="w-full"
          @update:model-value="preset"
        />
      </UFormField>
      <UFormField :name="`${id}-range`" :error="error || undefined">
        <div class="filter-range-fields">
          <div>
            <label :for="`${id}-from`" class="app-field-label">Start (UTC)</label>
            <UInput
              :id="`${id}-from`"
              v-model="from"
              type="datetime-local"
              aria-label="Start (UTC)"
              class="w-full font-mono"
            />
          </div>
          <div>
            <label :for="`${id}-to`" class="app-field-label">End (UTC)</label>
            <UInput
              :id="`${id}-to`"
              v-model="to"
              type="datetime-local"
              aria-label="End (UTC)"
              class="w-full font-mono"
            />
          </div>
        </div>
        <template v-if="error" #error
          ><p role="alert">{{ error }}</p></template
        >
      </UFormField>
      <div class="flex justify-end">
        <UButton label="Done" color="neutral" variant="outline" @click="close()" />
      </div>
    </div>
  </details>
</template>
