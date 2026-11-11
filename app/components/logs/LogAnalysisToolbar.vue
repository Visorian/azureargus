<script lang="ts">
export interface MobileQueryState {
  canRun: boolean
  hasRun: boolean
  dirty: boolean
  status: 'idle' | 'loading' | 'refreshing' | 'success' | 'error'
  pendingMessage: string
  rangeError: string | null
  error: string | null
}
</script>

<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'

const props = withDefaults(
  defineProps<{
    activeFilterCount?: number
    resultCount: number
    queryState?: MobileQueryState | null
  }>(),
  { activeFilterCount: 0, queryState: null },
)
const emit = defineEmits<{ interaction: [event: Event]; run: [] }>()
defineSlots<{
  search?: () => unknown
  filters?: () => unknown
  query?: (props: { mobile: boolean }) => unknown
  summary?: () => unknown
}>()
const isMobile = useMediaQuery('(max-width: 1023px)')
const filtersOpen = ref(false)
const root = useTemplateRef('root')
const queryArea = useTemplateRef('queryArea')
const sheetBody = useTemplateRef('sheetBody')
let returnTarget: HTMLElement | null = null
const needsQuery = computed(
  () =>
    props.queryState &&
    (!props.queryState.hasRun || props.queryState.dirty || props.queryState.error !== null),
)
const queryLoading = computed(
  () => props.queryState?.status === 'loading' || props.queryState?.status === 'refreshing',
)
const triggerLabel = computed(
  () =>
    `${props.queryState ? 'Query & filters' : 'Filters'}${props.activeFilterCount ? ` (${props.activeFilterCount})` : ''}`,
)
const footerLabel = computed(() => {
  if (queryLoading.value) {
    return 'Running query'
  }
  if (needsQuery.value) {
    return 'Run query'
  }
  return props.resultCount === 0
    ? 'Done'
    : `Show ${props.resultCount} ${props.resultCount === 1 ? 'result' : 'results'}`
})
watch(isMobile, () => {
  filtersOpen.value = false
})
watch(
  filtersOpen,
  (open) => {
    if (open) {
      returnTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
    }
  },
  { flush: 'sync' },
)

function focusInitialField(event: Event) {
  const field =
    props.queryState &&
    (!props.queryState.hasRun || props.queryState.rangeError !== null) &&
    sheetBody.value?.querySelector<HTMLInputElement>('input[type="datetime-local"]')
  if (field) {
    event.preventDefault()
    field.focus({ preventScroll: true })
  }
}

function restoreFocus(event: Event) {
  event.preventDefault()
  const target = returnTarget?.isConnected
    ? returnTarget
    : root.value?.querySelector<HTMLElement>('[data-query-trigger]')
  if (target instanceof HTMLElement) {
    target.focus({ preventScroll: true })
  }
}

function openFilters() {
  if (isMobile.value) {
    filtersOpen.value = true
  } else {
    queryArea.value?.querySelector('input')?.focus()
  }
}

function finish(event: MouseEvent) {
  if (queryLoading.value || (needsQuery.value && !props.queryState?.canRun)) {
    return
  }
  emit('interaction', event)
  if (needsQuery.value) {
    emit('run')
  } else {
    filtersOpen.value = false
  }
}

defineExpose({ openFilters })
</script>

<template>
  <div
    ref="root"
    class="shrink-0 border-b border-default px-4 py-2 lg:py-3"
    data-testid="log-analysis-toolbar"
  >
    <div class="flex flex-wrap items-center gap-2" data-testid="log-filter-row">
      <slot name="search" />
      <template v-if="!isMobile"><slot name="filters" /></template>
      <USlideover
        v-else
        v-model:open="filtersOpen"
        side="bottom"
        :title="queryState ? 'Query & filters' : 'Filters'"
        :content="{ onOpenAutoFocus: focusInitialField, onCloseAutoFocus: restoreFocus }"
        :ui="{
          overlay: 'z-50',
          content: 'z-50 mx-auto max-h-[90dvh] max-w-2xl rounded-t-xl motion-reduce:animate-none',
          footer: 'pb-[max(1rem,env(safe-area-inset-bottom))]',
        }"
      >
        <UButton
          data-query-trigger
          icon="i-lucide-sliders-horizontal"
          :aria-label="triggerLabel"
          :color="activeFilterCount ? 'primary' : 'neutral'"
          variant="outline"
          class="min-h-11 min-w-11 shrink-0 justify-center"
        >
          <span class="hidden min-[360px]:inline">{{ triggerLabel }}</span>
          <span v-if="activeFilterCount" class="min-[360px]:hidden">{{ activeFilterCount }}</span>
        </UButton>
        <template #close>
          <UButton
            icon="i-lucide-x"
            aria-label="Close"
            color="neutral"
            variant="ghost"
            class="ms-auto min-h-11 min-w-11"
          />
        </template>
        <template #body>
          <div
            ref="sheetBody"
            class="touch-fields space-y-5"
            @click.capture="emit('interaction', $event)"
            @input.capture="emit('interaction', $event)"
            @change.capture="emit('interaction', $event)"
          >
            <div v-if="$slots['query']" class="space-y-3">
              <slot name="query" :mobile="true" />
              <p
                v-if="queryState?.error"
                role="alert"
                class="text-sm text-red-700 dark:text-red-400"
              >
                {{ queryState.error }}
              </p>
              <p
                v-else-if="queryState?.hasRun && !needsQuery && !queryLoading"
                role="status"
                class="text-sm text-muted"
              >
                {{ resultCount }}
                {{ resultCount === 1 ? 'result' : 'results' }} ready.
              </p>
              <p v-if="queryState && !queryState.canRun" class="text-sm text-muted">
                Connect your Azure workspace in Settings to run a query.
              </p>
            </div>
            <div :class="$slots['query'] && 'border-t border-default pt-4'">
              <p class="mb-4 text-sm text-muted">
                {{
                  queryState
                    ? 'Refine your query with filters, or leave them empty to include all entries.'
                    : 'Filters update results as you change them.'
                }}
              </p>
              <div
                class="mobile-filter-fields grid grid-cols-2 gap-3"
                data-testid="log-filter-panel"
              >
                <slot name="filters" />
              </div>
            </div>
            <slot name="summary" />
          </div>
        </template>
        <template #footer>
          <UButton
            :label="footerLabel"
            :icon="queryLoading ? 'i-lucide-loader-circle' : undefined"
            :ui="{ leadingIcon: queryLoading ? 'animate-spin motion-reduce:animate-none' : '' }"
            :aria-disabled="Boolean(queryLoading || (needsQuery && !queryState?.canRun))"
            :aria-busy="queryLoading"
            class="min-h-11"
            block
            @click="finish"
          />
        </template>
      </USlideover>
    </div>
    <div
      v-if="
        isMobile &&
        queryState &&
        !filtersOpen &&
        !queryLoading &&
        (queryState.error || queryState.dirty)
      "
      role="status"
      class="mt-1 flex min-h-11 items-center justify-between gap-2 text-xs"
      :class="
        queryState.error ? 'text-red-700 dark:text-red-400' : 'text-amber-800 dark:text-amber-300'
      "
    >
      <span>{{
        queryState.error
          ? queryState.hasRun && resultCount > 0
            ? 'Last query failed. Showing previous results.'
            : 'Last query failed.'
          : queryState.pendingMessage
      }}</span>
      <UButton
        label="Review query"
        color="neutral"
        variant="link"
        class="touch-control shrink-0 p-0 text-xs underline"
        @click="openFilters"
      />
    </div>
    <div
      v-if="!isMobile && ($slots['query'] || $slots['summary'])"
      ref="queryArea"
      class="mt-3 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between"
      data-testid="log-query-row"
    >
      <slot name="query" :mobile="false" />
      <div
        v-if="$slots['summary']"
        class="py-2 text-xs text-muted"
        :class="$slots['query'] ? 'w-full xl:w-auto xl:self-end' : 'w-full'"
      >
        <slot name="summary" />
      </div>
    </div>
  </div>
</template>
