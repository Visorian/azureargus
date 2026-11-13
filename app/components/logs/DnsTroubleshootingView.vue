<script setup lang="ts">
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { RecycleScroller } from 'vue-virtual-scroller'
import type { RecycleScrollerExposed } from 'vue-virtual-scroller'

import type {
  DnsEntry,
  DnsFilterOptions,
  DnsFilters,
  DnsSort,
  DnsSourceStatus,
} from '#shared/types/dns'
import {
  DNS_COMPLETENESS_LABELS,
  DNS_OUTCOME_LABELS,
  DNS_OUTCOME_TONES,
  DNS_PATH_LABELS,
  dnsEntryClient,
  dnsEntryDestination,
  formatDnsDuration,
  isDnsOutcome,
} from '#shared/utils/dns'
import type { LogHourCycle } from '~/composables/useLogTimeFormat'
import type { MobileQueryState } from '~/types/logs'
import { DNS_ENTRY_COLUMNS, DNS_SORT_ITEMS, dnsSourceLabel } from '~/utils/dnsPresentation'

const filters = defineModel<DnsFilters>('filters', { required: true })
const sort = defineModel<DnsSort>('sort', { required: true })
const showUnidentifiedTransports = defineModel<boolean>('showUnidentifiedTransports', {
  required: true,
})
const props = withDefaults(
  defineProps<{
    hourCycle?: LogHourCycle
    timeZone?: string
    entries: DnsEntry[]
    sources: DnsSourceStatus[]
    status: 'idle' | 'loading' | 'success' | 'error'
    error: string | null
    entriesTruncated: boolean
    transportsTruncated: boolean
    logAnalysis: boolean
    liveConnected?: boolean
    queryState?: MobileQueryState | null
    filterOptions: DnsFilterOptions
    appliedFilters?: DnsFilters | null
    appliedRange?: { from: string; to: string } | null
  }>(),
  {
    hourCycle: 'h23',
    timeZone: 'UTC',
    liveConnected: false,
    queryState: null,
    appliedFilters: null,
    appliedRange: null,
  },
)
const emit = defineEmits<{
  interaction: [event: Event]
  run: []
  settings: [event: MouseEvent]
  reset: []
  select: [entry: DnsEntry]
}>()
defineSlots<{ queryControls?: (props: { mobile: boolean }) => unknown }>()
const isMobile = useMediaQuery('(max-width: 1023px)')
const tablet = useMediaQuery('(min-width: 768px)')
const entryViewport = useTemplateRef('entryViewport')
const { width: entryWidth } = useElementSize(entryViewport)
const mobileColumns = computed(() => (tablet.value ? 2 : 1))
const toolbar = useTemplateRef('toolbar')
const scroller = useTemplateRef<RecycleScrollerExposed<DnsEntry>>('scroller')
let selectedTriggerId = ''
const navigation = useVirtualResultsNavigation(
  toRef(props, 'entries'),
  entryViewport,
  scroller,
  computed(() => (isMobile.value ? mobileColumns.value : 1)),
  (entry) => {
    selectedTriggerId = entry.id
    emit('select', entry)
  },
)
const activeFilterCount = computed(
  () => Object.values(filters.value).filter((value) => value.trim() !== '').length,
)
const appliedFilterCount = computed(() => {
  const current = props.logAnalysis ? props.appliedFilters : filters.value
  return current ? Object.values(current).filter((value) => value.trim() !== '').length : 0
})
const sortSelection = computed<(typeof DNS_SORT_ITEMS)[number]['value']>({
  get: () =>
    DNS_SORT_ITEMS.find(
      (item) => item.key === sort.value.key && item.direction === sort.value.direction,
    )?.value ?? 'timestamp-desc',
  set: (value: string) => {
    const selected = DNS_SORT_ITEMS.find((item) => item.value === value)
    if (selected) {
      sort.value = { key: selected.key, direction: selected.direction }
    }
  },
})
function filterModel(key: 'queryType' | 'protocol' | 'outcome' | 'source') {
  return computed({
    get: () => filters.value[key] || 'all',
    set: (value: string) => {
      filters.value[key] = value === 'all' ? '' : value
    },
  })
}
const queryTypeFilter = filterModel('queryType')
const protocolFilter = filterModel('protocol')
const outcomeFilter = filterModel('outcome')
const sourceFilter = filterModel('source')
const outcomeItems = computed(() => [
  { label: 'Any result', value: 'all' },
  ...props.filterOptions.outcomes.map((value) => ({ label: DNS_OUTCOME_LABELS[value], value })),
])
const sourceItems = computed(() => [
  { label: 'Any source', value: 'all' },
  ...props.filterOptions.sources.map((value) => ({ label: dnsSourceLabel(value), value })),
])
const queryTypeItems = computed(() => [
  { label: 'Any type', value: 'all' },
  ...props.filterOptions.queryTypes.map((value) => ({ label: value, value })),
])
const protocolItems = computed(() => [
  { label: 'Any protocol', value: 'all' },
  ...props.filterOptions.protocols.map((value) => ({ label: value, value })),
])
const unavailableSources = computed(() =>
  props.sources.filter((source) => source.availability !== 'available'),
)
const allSourcesUnavailable = computed(
  () => props.sources.length > 0 && unavailableSources.value.length === props.sources.length,
)
const incompleteReasons = computed(() => [
  ...(props.entriesTruncated ? ['DNS entry limit reached. Narrow the filters or time range.'] : []),
  ...(props.transportsTruncated ? ['Unidentified transport limit reached.'] : []),
  ...unavailableSources.value.map(
    (source) =>
      `${dnsSourceLabel(source.source)}: ${source.warning ?? (source.availability === 'forbidden' ? 'Access denied.' : 'Query failed.')}`,
  ),
])
const emptyTitle = computed(() => {
  if (props.status === 'loading') {
    return 'Loading DNS activity'
  }
  if (props.error) {
    return 'DNS query failed'
  }
  if (allSourcesUnavailable.value) {
    return 'DNS sources unavailable'
  }
  if (props.logAnalysis && props.status === 'idle') {
    return 'Explore DNS activity'
  }
  if (!props.logAnalysis && !props.liveConnected) {
    return 'Connect to Event Hub'
  }
  return 'No DNS activity'
})
const emptyMessage = computed(() => {
  if (props.status === 'loading') {
    return 'Loading DNS entries…'
  }
  if (props.error) {
    return props.queryState ? 'Review the query and try again.' : props.error
  }
  if (allSourcesUnavailable.value) {
    return 'Check source access and readiness in Settings.'
  }
  if (props.logAnalysis && props.status === 'idle') {
    return 'Run DNS query to load entries.'
  }
  if (!props.logAnalysis && !props.liveConnected) {
    return 'Connect in Event Hub settings to receive live DNS activity.'
  }
  if (appliedFilterCount.value > 0) {
    return 'No entries match the applied filters.'
  }
  return props.logAnalysis
    ? 'No DNS entries were returned for this time range.'
    : 'DNS activity appears here as events arrive.'
})
const appliedSummary = computed(() => {
  const current = props.logAnalysis ? props.appliedFilters : filters.value
  if (!current) {
    return []
  }
  const details = [
    current.queryType,
    current.protocol,
    isDnsOutcome(current.outcome) ? DNS_OUTCOME_LABELS[current.outcome] : '',
    current.source ? dnsSourceLabel(current.source) : '',
  ].filter(Boolean)
  const lines = [
    `${props.logAnalysis ? 'Applied' : 'Active'} · ${current.client || 'All clients'}${details.length > 0 ? ` · ${details.join(' · ')}` : ''}`,
  ]
  if (current.search) {
    lines.push(`Search · ${current.search}`)
  }
  if (props.logAnalysis && props.appliedRange) {
    const date = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'UTC',
    })
    lines.push(
      `${date.format(new Date(props.appliedRange.from))}–${date.format(new Date(props.appliedRange.to))} UTC`,
    )
  }
  return lines
})
function restoreFocus() {
  navigation.restore(selectedTriggerId)
}
function openQuery(event: MouseEvent) {
  if (props.queryState?.canRun) {
    toolbar.value?.openRange()
  } else {
    emit('settings', event)
  }
}
function run() {
  toolbar.value?.runStarted()
  emit('run')
}
function retry() {
  toolbar.value?.focusRun()
  run()
}
function resetFromEmpty() {
  if (activeFilterCount.value > 0 || showUnidentifiedTransports.value) {
    emit('reset')
    if (!props.logAnalysis) {
      void nextTick(() => navigation.focus())
    }
  }
}
function toggleSort(key: DnsSort['key']) {
  sort.value = {
    key,
    direction: sort.value.key === key && sort.value.direction === 'desc' ? 'asc' : 'desc',
  }
}
defineExpose({ restoreFocus })
</script>

<template>
  <div class="dns-view">
    <LogsLogAnalysisToolbar
      ref="toolbar"
      :result-count="entries.length"
      :query-state="queryState"
      :active-filter-count="activeFilterCount"
      :applied-summary="appliedSummary"
      @run="run"
      @interaction="emit('interaction', $event)"
    >
      <template #search>
        <UFormField label="Search" class="min-w-0 flex-1">
          <UInput
            v-model="filters.search"
            icon="i-lucide-search"
            aria-label="Domain or DNS search"
            placeholder="Domain or text"
            class="w-full"
          />
        </UFormField>
      </template>
      <template #filters>
        <div class="dns-filter-fields" data-testid="dns-filter-grid">
          <UFormField label="Query type"
            ><USelect
              v-model="queryTypeFilter"
              :items="queryTypeItems"
              value-key="value"
              aria-label="Query type"
              class="w-full"
          /></UFormField>
          <UFormField label="Client"
            ><UInput
              v-model="filters.client"
              aria-label="DNS client"
              placeholder="Any client"
              class="w-full font-mono"
          /></UFormField>
          <UFormField label="Protocol"
            ><USelect
              v-model="protocolFilter"
              :items="protocolItems"
              value-key="value"
              aria-label="DNS protocol"
              class="w-full"
          /></UFormField>
          <UFormField label="Result"
            ><USelect
              v-model="outcomeFilter"
              :items="outcomeItems"
              value-key="value"
              aria-label="DNS result"
              class="w-full"
          /></UFormField>
          <UFormField label="Source" class="col-span-2 min-[641px]:col-span-1"
            ><USelect
              v-model="sourceFilter"
              :items="sourceItems"
              value-key="value"
              aria-label="DNS source"
              class="w-full"
          /></UFormField>
          <div class="dns-transport-toggle">
            <UCheckbox
              v-model="showUnidentifiedTransports"
              label="Show unidentified DNS transport"
            />
          </div>
        </div>
      </template>
      <template #actions
        ><LogsLogFilterActions
          :reset-disabled="activeFilterCount === 0 && !showUnidentifiedTransports"
          @reset="emit('reset')"
      /></template>
      <template v-if="$slots['queryControls']" #query="{ mobile }"
        ><slot name="queryControls" :mobile="mobile"
      /></template>
    </LogsLogAnalysisToolbar>
    <div class="dns-results-body">
      <AppNotice
        v-if="error && entries.length && !queryState"
        tone="error"
        title="Last query failed"
        :description="`${error} Previous results remain visible.`"
        ><template #actions
          ><UButton
            label="Retry query"
            color="neutral"
            variant="outline"
            :disabled="status === 'loading'"
            @click="retry" /></template
      ></AppNotice>
      <AppNotice v-if="incompleteReasons.length" tone="warning" title="Result incomplete"
        ><ul class="list-disc space-y-1 pl-4">
          <li v-for="reason in incompleteReasons" :key="reason">{{ reason }}</li>
        </ul></AppNotice
      >
      <section
        class="dns-results-panel flex min-h-0 flex-1 flex-col overflow-hidden"
        aria-labelledby="dns-entry-heading"
        :aria-busy="status === 'loading'"
      >
        <div
          class="dns-result-header flex shrink-0 flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <h2 id="dns-entry-heading" class="text-sm font-semibold">
            DNS activity
            <span class="text-xs font-normal text-muted">· Times in {{ timeZone }}</span>
          </h2>
          <UFormField label="Sort order" class="min-w-0"
            ><USelect
              v-model="sortSelection"
              :items="[...DNS_SORT_ITEMS]"
              aria-label="DNS sort order"
              class="w-full"
          /></UFormField>
        </div>
        <p id="dns-row-help" class="sr-only">
          Use Up and Down to move between entries. Press Enter to open details.
        </p>
        <div
          ref="entryViewport"
          class="virtual-results flex min-h-0 flex-1 flex-col"
          data-testid="dns-entry-scroll"
          role="grid"
          :aria-rowcount="entries.length + (isMobile ? 0 : 1)"
          :aria-colcount="isMobile ? 1 : 8"
          :aria-activedescendant="navigation.activeDescendant.value"
          aria-label="DNS results"
          aria-describedby="dns-row-help"
          tabindex="0"
          @keydown="navigation.keydown"
          @scroll.capture.passive="navigation.scrolled"
        >
          <ClientOnly>
            <RecycleScroller
              v-if="entries.length"
              ref="scroller"
              :items="entries"
              :item-size="isMobile ? 144 : 44"
              :grid-items="isMobile ? mobileColumns : undefined"
              :item-secondary-size="
                isMobile && entryWidth > 0 ? entryWidth / mobileColumns : undefined
              "
              key-field="id"
              list-tag="div"
              item-tag="div"
              emit-update
              class="dns-scroller min-h-0 flex-1"
              :class="isMobile && 'mobile-results'"
              @update="navigation.updateRange"
            >
              <template v-if="!isMobile" #before>
                <div
                  class="dns-entry-grid dns-result-header grid text-xs font-semibold"
                  role="row"
                  aria-rowindex="1"
                  data-testid="dns-entry-header"
                >
                  <span
                    v-for="column in DNS_ENTRY_COLUMNS"
                    :key="column.label"
                    role="columnheader"
                    :aria-sort="
                      column.key === sort.key
                        ? sort.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    "
                  >
                    <button
                      v-if="column.key"
                      type="button"
                      class="dns-sort-button"
                      :aria-label="`Sort by ${column.label.toLowerCase()}`"
                      @click="column.key && toggleSort(column.key)"
                    >
                      {{ column.label
                      }}<UIcon
                        :name="
                          column.key === sort.key
                            ? sort.direction === 'asc'
                              ? 'i-lucide-arrow-up'
                              : 'i-lucide-arrow-down'
                            : 'i-lucide-arrow-up-down'
                        "
                        class="size-3 shrink-0"
                      />
                    </button>
                    <template v-else>{{ column.label }}</template>
                  </span>
                </div>
              </template>
              <template #default="{ item, index, active }">
                <div
                  v-if="active"
                  :id="navigation.rowId(item.id)"
                  :data-result-index="index"
                  :data-dns-entry="item.id"
                  :aria-rowindex="index + (isMobile ? 1 : 2)"
                  :aria-selected="item.id === navigation.activeId.value"
                  :data-active="item.id === navigation.activeId.value"
                  role="row"
                  tabindex="-1"
                  :class="isMobile ? 'dns-mobile-row' : 'dns-entry-grid dns-entry-row'"
                  @focus.self="navigation.focus(item.id)"
                  @click="!isMobile && navigation.select(item)"
                >
                  <div v-if="isMobile" role="gridcell">
                    <button
                      type="button"
                      tabindex="-1"
                      class="dns-mobile-entry"
                      :aria-label="`Open DNS details for ${item.displayText ?? item.queryName ?? 'transport'} from ${dnsEntryClient(item)}`"
                      @click="navigation.select(item)"
                    >
                      <div class="flex items-center justify-between gap-2">
                        <NuxtTime
                          :datetime="item.timestamp"
                          month="short"
                          day="2-digit"
                          hour="2-digit"
                          minute="2-digit"
                          second="2-digit"
                          :hour-cycle="hourCycle"
                          :time-zone="timeZone"
                          class="font-mono text-muted"
                        /><AppStatusLabel
                          :tone="DNS_OUTCOME_TONES[item.outcome]"
                          :label="DNS_OUTCOME_LABELS[item.outcome]"
                        />
                      </div>
                      <span class="truncate font-mono text-sm font-medium">{{
                        item.displayText ?? item.queryName ?? 'Not observed'
                      }}</span>
                      <span class="truncate font-mono" :title="dnsEntryClient(item)"
                        >Client {{ dnsEntryClient(item) }}</span
                      >
                      <span
                        v-if="dnsEntryDestination(item) !== 'Not observed'"
                        class="truncate font-mono"
                        :title="dnsEntryDestination(item)"
                        >To {{ dnsEntryDestination(item) }}</span
                      >
                      <span class="mt-auto flex items-center justify-between gap-2 text-muted"
                        ><span>{{
                          [
                            item.queryType,
                            item.protocol,
                            item.durationSeconds !== undefined
                              ? formatDnsDuration(item.durationSeconds)
                              : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ') || DNS_PATH_LABELS[item.path]
                        }}</span
                        ><UIcon name="i-lucide-chevron-right" class="size-4"
                      /></span>
                    </button>
                  </div>
                  <template v-else>
                    <span role="gridcell" class="font-mono">
                      <NuxtTime
                        :datetime="item.timestamp"
                        month="short"
                        day="2-digit"
                        :time-zone="timeZone"
                        class="block"
                      />
                      <NuxtTime
                        :datetime="item.timestamp"
                        hour="2-digit"
                        minute="2-digit"
                        second="2-digit"
                        :hour-cycle="hourCycle"
                        :time-zone="timeZone"
                        class="block"
                      />
                    </span>
                    <span role="gridcell" class="min-w-0"
                      ><span
                        class="block truncate font-mono"
                        :title="item.displayText ?? item.queryName"
                        >{{ item.displayText ?? item.queryName ?? 'Not observed' }}</span
                      ><span class="block truncate text-muted">{{
                        [item.queryType, item.protocol, DNS_PATH_LABELS[item.path]]
                          .filter(Boolean)
                          .join(' · ')
                      }}</span></span
                    >
                    <span
                      role="gridcell"
                      class="truncate font-mono"
                      :title="dnsEntryClient(item)"
                      >{{ dnsEntryClient(item) }}</span
                    >
                    <span
                      role="gridcell"
                      class="truncate font-mono"
                      :title="dnsEntryDestination(item)"
                      >{{ dnsEntryDestination(item) }}</span
                    >
                    <AppStatusLabel
                      role="gridcell"
                      :tone="DNS_OUTCOME_TONES[item.outcome]"
                      :label="DNS_OUTCOME_LABELS[item.outcome]"
                    />
                    <span role="gridcell">{{
                      item.durationSeconds === undefined
                        ? '—'
                        : formatDnsDuration(item.durationSeconds)
                    }}</span>
                    <AppStatusLabel
                      role="gridcell"
                      :tone="item.completeness === 'complete' ? 'neutral' : 'warning'"
                      :label="DNS_COMPLETENESS_LABELS[item.completeness]"
                    />
                    <span role="gridcell">{{ item.observationCount }}</span>
                  </template>
                </div>
              </template>
            </RecycleScroller>
            <div
              v-else
              class="grid min-h-40 flex-1 place-items-center px-6 py-8 text-center text-sm"
              :role="error ? 'alert' : 'status'"
            >
              <div class="max-w-sm space-y-3">
                <UIcon
                  :name="
                    status === 'loading'
                      ? 'i-lucide-loader-circle'
                      : error
                        ? 'i-lucide-circle-alert'
                        : 'i-lucide-network'
                  "
                  class="size-7"
                  :class="status === 'loading' && 'animate-spin motion-reduce:animate-none'"
                />
                <h3 class="text-base font-semibold">{{ emptyTitle }}</h3>
                <p class="text-muted">{{ emptyMessage }}</p>
                <UButton
                  v-if="error && queryState?.canRun"
                  label="Retry query"
                  variant="outline"
                  color="neutral"
                  @click="retry"
                />
                <UButton
                  v-else-if="!logAnalysis && !liveConnected"
                  label="Open Event Hub settings"
                  icon="i-lucide-settings"
                  color="neutral"
                  variant="outline"
                  @click="emit('settings', $event)"
                />
                <UButton
                  v-else-if="allSourcesUnavailable || (logAnalysis && !queryState?.canRun)"
                  label="Open Log Analytics settings"
                  icon="i-lucide-settings"
                  variant="outline"
                  color="neutral"
                  @click="emit('settings', $event)"
                />
                <UButton
                  v-else-if="
                    status !== 'loading' &&
                    appliedFilterCount &&
                    (!logAnalysis || queryState?.hasRun)
                  "
                  label="Reset filters"
                  variant="outline"
                  color="neutral"
                  :aria-disabled="activeFilterCount === 0 && !showUnidentifiedTransports"
                  @click="resetFromEmpty"
                />
                <UButton
                  v-else-if="status !== 'loading' && logAnalysis && queryState?.hasRun"
                  label="Change time range"
                  icon="i-lucide-calendar-range"
                  variant="outline"
                  color="neutral"
                  @click="openQuery"
                />
              </div>
            </div>
          </ClientOnly>
        </div>
      </section>
    </div>
  </div>
</template>
