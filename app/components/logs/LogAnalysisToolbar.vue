<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

import type { MobileQueryState } from '~/types/logs'

const props = withDefaults(
  defineProps<{
    activeFilterCount?: number
    resultCount: number
    queryState?: MobileQueryState | null
    appliedSummary?: string[]
  }>(),
  { activeFilterCount: 0, queryState: null, appliedSummary: () => [] },
)
const emit = defineEmits<{ interaction: [event: Event]; run: [] }>()
defineSlots<{
  search?: () => unknown
  filters?: () => unknown
  query?: (props: { mobile: boolean }) => unknown
  actions?: () => unknown
  summary?: () => unknown
  compactSummary?: () => unknown
}>()
const id = useId()
const phone = useMediaQuery('(max-width: 640px)')
const filtersOpen = ref(false)
const root = useTemplateRef('root')
const editor = useTemplateRef('editor')
const toggle = useTemplateRef('toggle')
const runButton = useTemplateRef('runButton')
const loading = computed(
  () => props.queryState?.status === 'loading' || props.queryState?.status === 'refreshing',
)
const unavailable = computed(
  () => loading.value || !props.queryState?.canRun || Boolean(props.queryState?.rangeError),
)
const feedback = computed(() => {
  if (props.queryState?.rangeError) {
    return props.queryState.rangeError
  }
  if (loading.value) {
    return props.queryState?.hasRun
      ? 'Running query… Previous results remain visible.'
      : 'Running query…'
  }
  if (props.queryState?.error) {
    return props.queryState.hasRun
      ? `Last query failed. Showing previous results. ${props.queryState.error}`
      : props.queryState.error
  }
  if (props.queryState?.dirty) {
    return 'Changes not applied.'
  }
  if (props.queryState && !props.queryState.canRun) {
    return 'Connect your Azure workspace in Settings to run a query.'
  }
  return `${props.resultCount} ${props.resultCount === 1 ? 'result' : 'results'}${props.queryState ? '' : ' · Live filters update immediately.'}`
})
function openFilters() {
  filtersOpen.value = true
  nextTick(() => editor.value?.querySelector<HTMLElement>('input,button')?.focus())
}
function focusRun() {
  runButton.value?.$el.focus({ preventScroll: true })
}
async function openRange() {
  filtersOpen.value = true
  await nextTick()
  const range = root.value?.querySelector<HTMLDetailsElement>('details.filter-range')
  if (range) {
    range.open = true
    range.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
  }
}
function closeFilters() {
  filtersOpen.value = false
  nextTick(() => toggle.value?.$el.focus({ preventScroll: true }))
}
function runStarted() {
  for (const panel of root.value?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []) {
    const focused = panel.contains(document.activeElement)
    panel.open = false
    if (focused && !phone.value) {
      panel.querySelector<HTMLElement>('summary')?.focus({ preventScroll: true })
    }
  }
  if (phone.value) {
    filtersOpen.value = false
    nextTick(() => runButton.value?.$el.focus({ preventScroll: true }))
  }
}
function run(event: Event) {
  if (!props.queryState || unavailable.value) {
    return
  }
  emit('interaction', event)
  if (event.type === 'click') {
    runButton.value?.$el.focus({ preventScroll: true })
  }
  runStarted()
  emit('run')
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && phone.value && filtersOpen.value) {
    if (root.value?.querySelector('details[open]')) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    closeFilters()
  }
  if (
    event.key === 'Enter' &&
    !event.isComposing &&
    (event.target instanceof HTMLInputElement ||
      (event.target instanceof HTMLButtonElement &&
        event.target.getAttribute('role') === 'checkbox'))
  ) {
    event.preventDefault()
    run(event)
  }
}
watch(phone, (mobile) => {
  if (mobile && editor.value?.contains(document.activeElement)) {
    filtersOpen.value = true
  }
})
defineExpose({ openFilters, openRange, focusRun, runStarted })
</script>

<template>
  <div
    ref="root"
    class="connection-filters touch-fields"
    :data-collapsed="phone && !filtersOpen"
    data-testid="log-analysis-toolbar"
    @keydown="keydown"
  >
    <UButton
      v-if="phone"
      ref="toggle"
      data-query-trigger
      color="neutral"
      variant="outline"
      :aria-expanded="filtersOpen"
      :aria-controls="`${id}-filter-editor`"
      class="connection-edit-toggle"
      @click="filtersOpen ? closeFilters() : (filtersOpen = true)"
    >
      {{ filtersOpen ? 'Hide filters' : 'Edit filters'
      }}<span class="filter-count" :aria-hidden="activeFilterCount === 0">{{
        activeFilterCount ? `(${activeFilterCount})` : ''
      }}</span>
      <UIcon :name="filtersOpen ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'" />
    </UButton>
    <div v-if="phone && !filtersOpen" class="connection-overview">
      <slot name="compactSummary">
        <p
          v-for="(line, index) in appliedSummary"
          :key="index"
          :class="index === 0 ? 'font-mono' : 'text-muted'"
        >
          {{ line }}
        </p>
      </slot>
    </div>
    <div
      v-show="!phone || filtersOpen"
      :id="`${id}-filter-editor`"
      ref="editor"
      class="connection-editor"
      data-testid="log-filter-panel"
      @click.capture="emit('interaction', $event)"
      @input.capture="emit('interaction', $event)"
      @change.capture="emit('interaction', $event)"
    >
      <div class="connection-fields"><slot name="filters" /></div>
      <div class="connection-toolbar-row" data-testid="log-filter-row">
        <div class="connection-search"><slot name="search" /></div>
        <div class="connection-tools">
          <slot name="query" :mobile="phone" />
          <slot name="actions" />
        </div>
      </div>
    </div>
    <div class="connection-feedback-row">
      <p
        :role="queryState?.rangeError || queryState?.error ? 'alert' : 'status'"
        aria-live="polite"
        :class="
          queryState?.rangeError || queryState?.error
            ? 'text-error'
            : queryState?.dirty
              ? 'text-warning'
              : 'text-muted'
        "
      >
        {{ feedback }}
      </p>
      <UButton
        v-if="queryState"
        ref="runButton"
        data-run
        :icon="loading ? 'i-lucide-loader-circle' : 'i-lucide-search'"
        label="Run query"
        :aria-busy="loading"
        :aria-disabled="unavailable"
        class="connection-run"
        @click="run"
      />
    </div>
    <div v-show="!phone || filtersOpen" class="connection-extra"><slot name="summary" /></div>
    <div
      v-if="!phone && appliedSummary.length > 0 && queryState?.hasRun"
      class="connection-applied-summary text-xs text-muted"
    >
      <p v-for="line in appliedSummary" :key="line">{{ line }}</p>
    </div>
  </div>
</template>
