<script setup lang="ts">
import { useMediaQuery } from '@vueuse/core'
import { RecycleScroller } from 'vue-virtual-scroller'
import type { RecycleScrollerExposed } from 'vue-virtual-scroller'

import type {
  FirewallLogRecord,
  FirewallLogSortKey,
  FirewallLogSortState,
} from '#shared/types/firewall'
import type { IpCountryLookupClient } from '~/composables/useIpCountryLookup'
import type { LogHourCycle } from '~/composables/useLogTimeFormat'
import type { LogQuickFilterKey } from '~/types/logs'
import { logActionTone, logCategoryLabel } from '~/utils/logFilterPresentation'

const props = defineProps<{
  logs: FirewallLogRecord[]
  lookup: IpCountryLookupClient
  timeZone: string
  hourCycle: LogHourCycle
  sort: FirewallLogSortState
  active: (key: LogQuickFilterKey, value: string | undefined) => boolean
}>()
const emit = defineEmits<{
  select: [record: FirewallLogRecord]
  sort: [key: FirewallLogSortKey]
  filter: [key: LogQuickFilterKey, value: string | undefined]
}>()
const scroller = useTemplateRef<RecycleScrollerExposed<FirewallLogRecord>>('scroller')
const viewport = useTemplateRef('viewport')
const coarsePointer = useMediaQuery('(pointer: coarse)')
const rowHeight = computed(() => (coarsePointer.value ? 96 : 64))
const navigation = useVirtualResultsNavigation(
  computed(() => props.logs),
  viewport,
  scroller,
  computed(() => 1),
  (record) => emit('select', record),
)
function filter(key: LogQuickFilterKey, value: string | undefined, id: string) {
  navigation.focus(id)
  emit('filter', key, value)
}
const columns: {
  key: FirewallLogSortKey
  label: string
  portKey?: FirewallLogSortKey
  portLabel?: string
}[] = [
  { key: 'timestamp', label: 'Date' },
  { key: 'category', label: 'Category' },
  { key: 'action', label: 'Action' },
  { key: 'protocol', label: 'Protocol' },
  { key: 'sourceIp', label: 'Source', portKey: 'sourcePort', portLabel: 'Source port' },
  {
    key: 'destinationIp',
    label: 'Destination',
    portKey: 'destinationPort',
    portLabel: 'Destination port',
  },
  { key: 'rule', label: 'Rule' },
]
function ariaSort(key: FirewallLogSortKey, portKey?: FirewallLogSortKey) {
  if (props.sort.key !== key && props.sort.key !== portKey) {
    return 'none'
  }
  return props.sort.direction === 'asc' ? 'ascending' : 'descending'
}
</script>

<template>
  <div
    ref="viewport"
    class="log-table virtual-results"
    role="grid"
    :aria-rowcount="logs.length + 1"
    :aria-colcount="7"
    :aria-activedescendant="navigation.activeDescendant.value"
    aria-label="Firewall logs"
    tabindex="0"
    data-testid="log-table-scroll"
    @keydown="navigation.keydown"
    @scroll.capture.passive="navigation.scrolled"
  >
    <div class="log-table-inner">
      <div role="row" class="log-grid log-header">
        <div
          v-for="column in columns"
          :key="column.key"
          role="columnheader"
          :aria-sort="ariaSort(column.key, column.portKey)"
          class="log-header-group"
        >
          <LogsLogSortButton
            :label="column.key === 'timestamp' ? `Date (${timeZone})` : column.label"
            :sort-key="column.key"
            :sort="sort"
            @sort="emit('sort', $event)"
          />
          <LogsLogSortButton
            v-if="column.portKey"
            label="Port"
            :accessible-label="column.portLabel"
            :sort-key="column.portKey"
            :sort="sort"
            @sort="emit('sort', $event)"
          />
        </div>
      </div>
      <RecycleScroller
        ref="scroller"
        v-slot="{ item, index, active: poolActive }"
        :items="logs"
        :item-size="rowHeight"
        key-field="id"
        emit-update
        class="min-h-0 flex-1"
        @update="navigation.updateRange"
      >
        <div
          v-if="poolActive"
          :id="navigation.rowId(item.id)"
          :data-result-index="index"
          role="row"
          tabindex="-1"
          :data-active="item.id === navigation.activeId.value"
          :aria-selected="item.id === navigation.activeId.value"
          :data-log-id="item.id"
          :aria-rowindex="index + 2"
          class="log-grid log-row"
          @focus.self="navigation.focus(item.id)"
          @click="navigation.select(item)"
        >
          <span role="gridcell" class="log-cell font-mono"
            ><NuxtTime
              :datetime="item.timestamp"
              month="short"
              day="2-digit"
              :time-zone="timeZone" /><NuxtTime
              :datetime="item.timestamp"
              hour="2-digit"
              minute="2-digit"
              second="2-digit"
              :hour-cycle="hourCycle"
              :time-zone="timeZone"
          /></span>
          <span role="gridcell" class="log-cell"
            ><LogsLogQuickFilterCell
              :tabbable="item.id === navigation.activeId.value"
              :value="item.category"
              :display="logCategoryLabel(item.category)"
              label="category"
              :active="active('category', item.category)"
              @filter="filter('category', item.category, item.id)"
          /></span>
          <span role="gridcell" class="log-cell"
            ><LogsLogQuickFilterCell
              :value="item.action"
              label="action"
              :tabbable="item.id === navigation.activeId.value"
              :active="active('action', item.action)"
              @filter="filter('action', item.action, item.id)"
              ><AppStatusLabel
                :label="item.action || 'Unknown'"
                :tone="logActionTone(item.action)" /></LogsLogQuickFilterCell
          ></span>
          <span role="gridcell" class="log-cell"
            ><LogsLogQuickFilterCell
              :tabbable="item.id === navigation.activeId.value"
              :value="item.protocol"
              label="protocol"
              :active="active('protocol', item.protocol)"
              @filter="filter('protocol', item.protocol, item.id)"
          /></span>
          <span role="gridcell" class="log-cell"
            ><LogsLogQuickFilterCell
              :tabbable="item.id === navigation.activeId.value"
              :value="item.sourceIp"
              label="source"
              mono
              :active="active('source', item.sourceIp)"
              @filter="filter('source', item.sourceIp, item.id)" /><LogsLogQuickFilterCell
              v-if="item.sourcePort"
              :tabbable="item.id === navigation.activeId.value"
              :value="item.sourcePort"
              label="source port"
              mono
              :active="active('sourcePort', item.sourcePort)"
              @filter="filter('sourcePort', item.sourcePort, item.id)"
          /></span>
          <span role="gridcell" class="log-cell"
            ><span class="flex min-w-0 items-center gap-1"
              ><DestinationCountryFlag
                v-if="item.destinationIp"
                :destination="item.destinationIp"
                :lookup="lookup" /><LogsLogQuickFilterCell
                :tabbable="item.id === navigation.activeId.value"
                :value="item.destinationIp"
                label="destination"
                mono
                :active="active('destination', item.destinationIp)"
                @filter="filter('destination', item.destinationIp, item.id)" /></span
            ><LogsLogQuickFilterCell
              v-if="item.destinationPort"
              :tabbable="item.id === navigation.activeId.value"
              :value="item.destinationPort"
              label="destination port"
              mono
              :active="active('destinationPort', item.destinationPort)"
              @filter="filter('destinationPort', item.destinationPort, item.id)"
          /></span>
          <span role="gridcell" class="log-cell font-mono"
            ><span class="truncate" :title="item.rule">{{ item.rule || '—' }}</span
            ><span
              v-if="item.ruleCollection"
              class="truncate text-muted"
              :title="item.ruleCollection"
              >{{ item.ruleCollection }}</span
            ></span
          >
        </div>
      </RecycleScroller>
    </div>
  </div>
</template>
