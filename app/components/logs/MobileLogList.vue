<script setup lang="ts">
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { RecycleScroller } from 'vue-virtual-scroller'

import type { FirewallLogRecord } from '#shared/types/firewall'
import type { IpCountryLookupClient } from '~/composables/useIpCountryLookup'
import type { LogHourCycle } from '~/composables/useLogTimeFormat'

defineProps<{
  formatTimestamp: (timestamp: string) => string
  lookup: IpCountryLookupClient
  logs: FirewallLogRecord[]
  timeZone: string
  hourCycle: LogHourCycle
}>()
const emit = defineEmits<{ select: [log: FirewallLogRecord] }>()
const viewport = useTemplateRef('viewport')
const { width } = useElementSize(viewport)
const tablet = useMediaQuery('(min-width: 768px)')
const columns = computed(() => (tablet.value ? 2 : 1))

function destination(log: FirewallLogRecord) {
  return log.destinationIp || log.dns?.queryName || log.message || log.category
}

function source(log: FirewallLogRecord) {
  return log.sourceIp || log.dns?.clientIp || 'Not recorded'
}

function actionClass(action: string) {
  if (action.toLowerCase() === 'deny') {
    return 'text-red-700 dark:text-red-400'
  }
  if (action.toLowerCase() === 'allow') {
    return 'text-green-700 dark:text-green-400'
  }
  return 'text-default'
}
</script>

<template>
  <div ref="viewport" class="min-h-0 flex-1 px-4" data-testid="mobile-log-list">
    <RecycleScroller
      v-if="width > 0"
      v-slot="{ item, index, active }"
      :items="logs"
      :item-size="152"
      :grid-items="columns"
      :item-secondary-size="width / columns"
      key-field="id"
      class="mobile-results h-full"
      role="region"
      aria-label="Firewall logs"
    >
      <button
        v-if="active"
        type="button"
        class="flex h-36 min-w-0 flex-col gap-1 rounded-lg border border-default bg-default p-3 text-left text-sm hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        :class="tablet ? ['w-[calc(100%-0.25rem)]', index % 2 === 1 && 'ml-1'] : 'w-full'"
        :aria-label="`Open log details for ${destination(item)} at ${formatTimestamp(item.timestamp)}. ${item.action || 'Unknown action'}, ${item.protocol || 'unknown protocol'}, from ${source(item)}. ${item.category}.`"
        @click="emit('select', item)"
      >
        <span class="flex items-center justify-between gap-2 text-xs">
          <NuxtTime
            :datetime="item.timestamp"
            month="short"
            day="2-digit"
            hour="2-digit"
            minute="2-digit"
            second="2-digit"
            :time-zone="timeZone"
            :hour-cycle="hourCycle"
            class="text-muted"
          />
          <span class="font-semibold" :class="actionClass(item.action)">{{
            item.action || 'Unknown action'
          }}</span>
        </span>
        <span
          class="mobile-log-endpoint flex min-w-0 items-start gap-1 font-mono text-sm leading-[18px] font-medium"
        >
          <DestinationCountryFlag
            v-if="item.destinationIp"
            :destination="item.destinationIp"
            :lookup="lookup"
          />
          <span class="line-clamp-3 wrap-anywhere"
            >{{ destination(item)
            }}<span v-if="item.destinationPort" class="whitespace-nowrap text-muted"
              >:{{ item.destinationPort }}</span
            ></span
          >
        </span>
        <span class="flex min-w-0 items-center gap-2 text-xs">
          <span class="shrink-0 text-muted">Source</span>
          <span class="truncate font-mono"
            >{{ source(item)
            }}<span v-if="item.sourcePort || item.dns?.clientPort" class="text-muted"
              >:{{ item.sourcePort || item.dns?.clientPort }}</span
            ></span
          >
        </span>
        <span class="mt-auto flex items-center justify-between gap-2 text-xs text-muted">
          <span class="truncate" :title="item.category">{{ item.category }}</span>
          <span class="flex shrink-0 items-center gap-2"
            ><span class="font-mono">{{ item.protocol || 'Unknown protocol' }}</span
            ><UIcon name="i-lucide-chevron-right" class="size-4"
          /></span>
        </span>
      </button>
    </RecycleScroller>
    <p class="sr-only">Times shown in {{ timeZone }}. Open a log to view all fields.</p>
  </div>
</template>
