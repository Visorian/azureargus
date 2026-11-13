<script setup lang="ts">
import type { FirewallLogRecord } from '#shared/types/firewall'
import type { IpCountryLookupClient } from '~/composables/useIpCountryLookup'
import { formatIcmpProtocol } from '~/utils/icmpProtocol'
import { formatLogEndpoint } from '~/utils/logFilterPresentation'

const open = defineModel<boolean>('open', { required: true })
const props = defineProps<{
  record: FirewallLogRecord | null
  lookup: IpCountryLookupClient
  timeZone: string
  formatTimestamp: (value: string) => string
  live: boolean
}>()
const emit = defineEmits<{ afterLeave: [] }>()
const connectionFields = computed(() =>
  props.record
    ? [
        {
          label: 'Source',
          value: formatLogEndpoint(props.record.sourceIp, props.record.sourcePort),
          mono: true,
        },
        {
          label: 'Destination',
          value: formatLogEndpoint(props.record.destinationIp, props.record.destinationPort),
          mono: true,
        },
        { label: 'Action', value: props.record.action },
        { label: 'Protocol', value: formatIcmpProtocol(props.record.protocol) },
        { label: 'Timestamp', value: props.formatTimestamp(props.record.timestamp), mono: true },
        { label: 'Category', value: props.record.category },
      ]
    : [],
)
const ruleFields = computed(() =>
  props.record
    ? [
        { label: 'Policy', value: props.record.policy || 'Not recorded', mono: true },
        {
          label: 'Rule collection group',
          value: props.record.ruleCollectionGroup || 'Not recorded',
          mono: true,
        },
        {
          label: 'Rule collection',
          value: props.record.ruleCollection || 'Not recorded',
          mono: true,
        },
        { label: 'Rule', value: props.record.rule || 'Not recorded', mono: true },
      ]
    : [],
)
const metadata = computed(() =>
  props.record && props.live
    ? [
        { label: 'Sequence', value: props.record.sequenceNumber || '', mono: true },
        {
          label: 'Enqueued',
          value: props.record.enqueuedTimeUtc
            ? props.formatTimestamp(props.record.enqueuedTimeUtc)
            : '',
          mono: true,
        },
      ].filter((field) => field.value)
    : [],
)
</script>

<template>
  <UModal
    v-model:open="open"
    title="Log detail"
    :description="`Times shown in ${timeZone}`"
    @after:leave="emit('afterLeave')"
  >
    <template #body>
      <div v-if="record" class="space-y-5">
        <div v-if="record.destinationIp" class="flex items-center gap-2 text-xs text-muted">
          <span>Destination</span
          ><DestinationCountryFlag :destination="record.destinationIp" :lookup="lookup" />
        </div>
        <AppFieldList :fields="connectionFields" copyable />
        <section class="space-y-3">
          <h3 class="text-base font-semibold">Rule</h3>
          <AppFieldList :fields="ruleFields" copyable />
        </section>
        <section v-if="metadata.length" class="space-y-3">
          <h3 class="text-base font-semibold">Event Hub metadata</h3>
          <AppFieldList :fields="metadata" copyable />
        </section>
        <section v-if="record.message" class="space-y-2">
          <h3 class="text-base font-semibold">Message</h3>
          <p class="font-mono text-xs wrap-anywhere">{{ record.message }}</p>
        </section>
        <AppRawRecord :value="JSON.stringify(record.raw, null, 2)" label="Raw message" />
      </div>
    </template>
  </UModal>
</template>
