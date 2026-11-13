<script setup lang="ts">
import type { DnsDetailQueryResponse, DnsEntry } from '#shared/types/dns'
import {
  DNS_COMPLETENESS_LABELS,
  DNS_CONFIDENCE_LABELS,
  DNS_OUTCOME_LABELS,
  DNS_OUTCOME_TONES,
  DNS_PATH_LABELS,
  DNS_QUERY_TYPE_LABELS,
  DNS_STAGE_LABELS,
  dnsEntryClient,
  dnsEntryDestination,
} from '#shared/utils/dns'
import type { LogHourCycle } from '~/composables/useLogTimeFormat'
import {
  DNS_SOURCE_AVAILABILITY_LABELS,
  dnsModalTitle,
  dnsObservationFields,
  dnsRelatedFields,
  dnsSourceLabel,
  dnsStageActor,
} from '~/utils/dnsPresentation'

const open = defineModel<boolean>('open', { required: true })
const props = withDefaults(
  defineProps<{
    entry: DnsEntry | null
    detail: DnsDetailQueryResponse | null
    error: string | null
    loading: boolean
    hourCycle?: LogHourCycle
    timeZone?: string
  }>(),
  { hourCycle: 'h23', timeZone: 'UTC' },
)
const emit = defineEmits<{ closeAutoFocus: [event: Event]; retry: [] }>()
const observations = computed(() => props.detail?.observations ?? props.entry?.observations ?? [])
const relatedEvidence = computed(() => props.detail?.relatedEvidence ?? [])
const summaryFields = computed(() => {
  const entry = props.entry
  if (!entry) {
    return []
  }
  return [
    {
      label: 'DNS name or message',
      value: entry.displayText ?? entry.queryName ?? 'Not observed',
      mono: true,
    },
    { label: 'Client', value: dnsEntryClient(entry), mono: true },
    { label: 'Destination', value: dnsEntryDestination(entry), mono: true },
    {
      label: 'Type',
      value: entry.queryType
        ? [entry.queryType, DNS_QUERY_TYPE_LABELS[entry.queryType]].filter(Boolean).join(' — ')
        : 'Not observed',
    },
    { label: 'Protocol', value: entry.protocol ?? 'Not observed' },
    { label: 'Path', value: DNS_PATH_LABELS[entry.path] },
    { label: 'Source', value: dnsSourceLabel(entry.source) },
    { label: 'Correlation', value: DNS_CONFIDENCE_LABELS[entry.confidence] },
    {
      label: 'Evidence',
      value: DNS_COMPLETENESS_LABELS[props.detail?.completeness ?? entry.completeness],
    },
  ]
})
const incompleteReasons = computed(() => {
  if (!props.detail) {
    return []
  }
  return [
    ...new Set([
      ...(props.detail.detailTruncated
        ? ['Detail observation limit reached. Flow is incomplete.']
        : []),
      ...props.detail.warnings,
      ...(props.detail.relatedSources ?? []).flatMap((source) => {
        if (source.warning) {
          return [source.warning]
        }
        return source.truncated ? [`${dnsSourceLabel(source.source)}: result limit reached.`] : []
      }),
    ]),
  ]
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="dnsModalTitle(entry)"
    :content="{ onCloseAutoFocus: (event: Event) => emit('closeAutoFocus', event) }"
    :description="`Times shown in ${timeZone}`"
  >
    <template #body>
      <div v-if="entry" class="space-y-6" :aria-busy="loading">
        <div class="space-y-3">
          <AppStatusLabel
            :tone="DNS_OUTCOME_TONES[entry.outcome]"
            :label="DNS_OUTCOME_LABELS[entry.outcome]"
          />
          <AppFieldList :fields="summaryFields" copyable />
        </div>
        <div
          v-if="loading"
          role="status"
          class="flex min-h-32 items-center justify-center gap-3 text-sm text-muted"
        >
          <UIcon
            name="i-lucide-loader-circle"
            class="size-5 animate-spin motion-reduce:animate-none"
          />Loading DNS observations…
        </div>
        <AppNotice v-if="error" tone="error" title="DNS detail query failed" :description="error"
          ><template #actions
            ><UButton
              label="Retry details"
              color="neutral"
              variant="outline"
              @click="emit('retry')" /></template
        ></AppNotice>
        <AppNotice v-if="incompleteReasons.length" tone="warning" title="Result incomplete"
          ><ul class="list-disc space-y-1 pl-4">
            <li v-for="reason in incompleteReasons" :key="reason">{{ reason }}</li>
          </ul></AppNotice
        >
        <section
          v-if="!loading && observations.length"
          aria-labelledby="dns-flow-heading"
          class="space-y-3"
        >
          <h3 id="dns-flow-heading" class="text-base font-semibold">Observed flow</h3>
          <ol class="space-y-4">
            <li
              v-for="(observation, index) in observations"
              :key="observation.id"
              class="space-y-3 border-t border-default pt-4"
            >
              <div class="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 class="text-sm font-semibold">
                    {{ index + 1 }}. {{ DNS_STAGE_LABELS[observation.stage] }}
                  </h4>
                  <p class="text-xs text-muted">{{ dnsStageActor(observation) }}</p>
                </div>
                <AppStatusLabel
                  :tone="DNS_OUTCOME_TONES[observation.outcome]"
                  :label="DNS_OUTCOME_LABELS[observation.outcome]"
                />
              </div>
              <dl class="grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt class="text-xs text-muted">Event time</dt>
                  <dd class="font-mono text-xs">
                    <NuxtTime
                      :datetime="observation.timestamp"
                      date-style="medium"
                      time-style="medium"
                      :hour-cycle="hourCycle"
                      :time-zone="timeZone"
                    />
                  </dd>
                </div>
                <div v-if="observation.enqueuedTimeUtc">
                  <dt class="text-xs text-muted">Event Hub enqueued</dt>
                  <dd class="font-mono text-xs">
                    <NuxtTime
                      :datetime="observation.enqueuedTimeUtc"
                      date-style="medium"
                      time-style="medium"
                      :hour-cycle="hourCycle"
                      :time-zone="timeZone"
                    />
                  </dd>
                </div>
              </dl>
              <AppFieldList :fields="dnsObservationFields(observation)" copyable />
              <AppRawRecord :value="JSON.stringify(observation.raw, null, 2)" label="Raw message" />
            </li>
          </ol>
        </section>
        <p
          v-if="
            detail &&
            entry.source === 'proxy-structured' &&
            !observations.some((observation) => observation.stage === 'proxy-exchange')
          "
          class="text-sm text-muted"
        >
          Not observed: terminal response.
        </p>
        <section
          v-if="detail?.relatedSources?.length"
          aria-labelledby="dns-related-heading"
          class="space-y-3"
        >
          <div>
            <h3 id="dns-related-heading" class="text-base font-semibold">
              Nearby firewall evidence
            </h3>
            <p class="mt-1 text-xs text-muted">
              Fixed-window matches from the same firewall and available endpoint or FQDN anchors.
              Azure provides no explicit correlation ID; these records are not asserted to belong to
              this DNS transaction.
            </p>
          </div>
          <ul class="grid gap-3 sm:grid-cols-3">
            <li
              v-for="source in detail.relatedSources"
              :key="source.source"
              class="space-y-1 text-xs"
            >
              <p class="font-medium">{{ dnsSourceLabel(source.source) }}</p>
              <AppStatusLabel
                :tone="
                  source.availability === 'forbidden' ||
                  source.availability === 'failed' ||
                  source.truncated
                    ? 'warning'
                    : 'neutral'
                "
                :label="`${DNS_SOURCE_AVAILABILITY_LABELS[source.availability]}${source.truncated ? ' · Truncated' : ''}`"
              />
            </li>
          </ul>
          <p v-if="relatedEvidence.length === 0" class="text-sm text-muted">
            No nearby firewall evidence matched available anchors.
          </p>
          <article
            v-for="evidence in relatedEvidence"
            :key="evidence.id"
            class="space-y-3 border-t border-default pt-4 text-sm"
          >
            <div>
              <h4 class="font-semibold">{{ dnsSourceLabel(evidence.source) }}</h4>
              <p class="text-xs text-muted">
                Matched on {{ evidence.matchBasis }}. Uncorrelated nearby evidence.
              </p>
            </div>
            <dl>
              <dt class="text-xs text-muted">Event time</dt>
              <dd class="font-mono text-xs">
                <NuxtTime
                  :datetime="evidence.timestamp"
                  date-style="medium"
                  time-style="medium"
                  :hour-cycle="hourCycle"
                  :time-zone="timeZone"
                />
              </dd>
            </dl>
            <AppFieldList :fields="dnsRelatedFields(evidence)" copyable />
            <AppRawRecord :value="JSON.stringify(evidence.raw, null, 2)" label="Raw message" />
          </article>
        </section>
      </div>
    </template>
  </UModal>
</template>
