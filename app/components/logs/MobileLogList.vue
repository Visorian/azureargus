<script setup lang="ts">
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { RecycleScroller } from 'vue-virtual-scroller'
import type { RecycleScrollerExposed } from 'vue-virtual-scroller'

import type { FirewallLogRecord } from '#shared/types/firewall'
import type { IpCountryLookupClient } from '~/composables/useIpCountryLookup'
import type { LogHourCycle } from '~/composables/useLogTimeFormat'
import { formatLogEndpoint, logActionTone, logDestination } from '~/utils/logFilterPresentation'

const props = defineProps<{
  formatTimestamp: (timestamp: string) => string
  lookup: IpCountryLookupClient
  logs: FirewallLogRecord[]
  timeZone: string
  hourCycle: LogHourCycle
}>()
const emit = defineEmits<{ select: [log: FirewallLogRecord] }>()
const viewport = useTemplateRef('viewport')
const scroller = useTemplateRef<RecycleScrollerExposed<FirewallLogRecord>>('scroller')
const { width } = useElementSize(viewport)
const tablet = useMediaQuery('(min-width: 768px)')
const columns = computed(() => (tablet.value ? 2 : 1))
const navigation = useVirtualResultsNavigation(
  computed(() => props.logs),
  viewport,
  scroller,
  columns,
  (record) => emit('select', record),
)
</script>

<template>
  <div
    ref="viewport"
    class="virtual-results min-h-0 flex-1"
    data-testid="mobile-log-list"
    role="grid"
    aria-label="Firewall logs"
    :aria-rowcount="logs.length"
    :aria-colcount="1"
    :aria-activedescendant="navigation.activeDescendant.value"
    tabindex="0"
    @keydown="navigation.keydown"
    @scroll.capture.passive="navigation.scrolled"
  >
    <RecycleScroller
      v-if="width > 0"
      ref="scroller"
      v-slot="{ item, index, active }"
      :items="logs"
      :item-size="136"
      :grid-items="columns"
      :item-secondary-size="width / columns"
      key-field="id"
      class="mobile-results h-full"
      emit-update
      @update="navigation.updateRange"
    >
      <div
        v-if="active"
        :id="navigation.rowId(item.id)"
        :data-result-index="index"
        role="row"
        :data-active="item.id === navigation.activeId.value"
        :aria-selected="item.id === navigation.activeId.value"
        :aria-rowindex="index + 1"
        class="log-mobile-row"
      >
        <div role="gridcell">
          <button
            tabindex="-1"
            type="button"
            class="log-mobile-card"
            :class="tablet && index % 2 === 1 && 'log-mobile-card-second'"
            :aria-label="`Open log details. ${item.action || 'Unknown action'}, ${item.protocol || 'unknown protocol'}, from ${formatLogEndpoint(item.sourceIp, item.sourcePort)} to ${formatLogEndpoint(item.destinationIp, item.destinationPort)} at ${formatTimestamp(item.timestamp)}. ${item.rule || item.category}.`"
            @click="navigation.select(item)"
          >
            <span class="flex items-center justify-between gap-2"
              ><NuxtTime
                :datetime="item.timestamp"
                month="short"
                day="2-digit"
                hour="2-digit"
                minute="2-digit"
                second="2-digit"
                :time-zone="timeZone"
                :hour-cycle="hourCycle"
                class="font-mono text-xs text-muted" /><AppStatusLabel
                :label="item.action || 'Unknown'"
                :tone="logActionTone(item.action)"
            /></span>
            <span class="log-mobile-endpoint"
              ><span class="text-muted">From</span
              ><span class="truncate font-mono">{{
                formatLogEndpoint(
                  item.sourceIp || item.dns?.clientIp,
                  item.sourcePort || item.dns?.clientPort,
                )
              }}</span></span
            >
            <span class="log-mobile-endpoint"
              ><span class="text-muted">To</span
              ><span class="mobile-log-endpoint flex min-w-0 items-center gap-1"
                ><DestinationCountryFlag
                  v-if="item.destinationIp"
                  :destination="item.destinationIp"
                  :lookup="lookup"
                /><span class="min-w-0 truncate font-mono">{{
                  formatLogEndpoint(logDestination(item), item.destinationPort)
                }}</span></span
              ></span
            >
            <span class="flex min-w-0 items-center justify-between gap-2 text-xs text-muted"
              ><span class="truncate font-mono" :title="item.rule || item.category">{{
                item.rule || item.category
              }}</span
              ><span class="flex shrink-0 items-center gap-1"
                >{{ item.protocol || 'Unknown'
                }}<UIcon name="i-lucide-chevron-right" class="size-4" /></span
            ></span>
          </button>
        </div>
      </div>
    </RecycleScroller>
    <p class="sr-only">Times shown in {{ timeZone }}. Open a log to view all fields.</p>
  </div>
</template>
