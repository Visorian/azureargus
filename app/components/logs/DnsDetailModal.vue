<script setup lang="ts">
import type {
  DnsDetailQueryResponse,
  DnsEntry,
  DnsObservation,
  DnsRelatedEvidence,
  DnsRelatedSourceKind,
} from "#shared/types/dns";
import {
  DNS_CLASS_LABELS,
  DNS_FLAG_LABELS,
  DNS_OUTCOME_LABELS,
  DNS_QUERY_TYPE_LABELS,
  DNS_RCODE_LABELS,
} from "#shared/utils/dns";
import type { LogHourCycle } from "~/composables/useLogTimeFormat";

const props = withDefaults(
  defineProps<{
    entry: DnsEntry | null;
    detail: DnsDetailQueryResponse | null;
    error: string | null;
    loading: boolean;
    hourCycle?: LogHourCycle;
  }>(),
  { hourCycle: "h23" },
);
const open = defineModel<boolean>("open", { required: true });
const toast = useToast();
const observations = computed(() => props.detail?.observations ?? props.entry?.observations ?? []);
const relatedEvidence = computed(() => props.detail?.relatedEvidence ?? []);
const modalTitle = computed(() => {
  if (props.entry?.source === "network-rule") return "DNS transport detail";
  if (props.entry?.source === "dns-flow-trace") return "DNS flow trace detail";
  if (props.entry?.source === "internal-fqdn-failure") return "Internal FQDN failure detail";
  return "DNS resolution detail";
});

function stageLabel(observation: DnsObservation) {
  if (observation.stage === "proxy-exchange") return "Proxy exchange";
  if (observation.stage === "dns-flow-trace") return "DNS flow trace";
  if (observation.stage === "internal-resolution") return "Internal resolution failure";
  return "Transport";
}

function rawJson(item: DnsObservation | DnsRelatedEvidence) {
  return JSON.stringify(item.raw, null, 2);
}

function rawRowCount(item: DnsObservation | DnsRelatedEvidence) {
  return Math.min(Math.max(rawJson(item).split("\n").length, 6), 24);
}

function stageActor(observation: DnsObservation) {
  if (observation.stage === "transport") return "Network rule";
  if (observation.stage === "internal-resolution") return "Azure Firewall resolver";
  return "Azure Firewall";
}

const relatedSourceLabels: Record<DnsRelatedSourceKind, string> = {
  "application-rule": "Application rule",
  "flow-trace": "TCP flow trace",
  "nat-rule": "NAT rule",
};

function duration(seconds: number | undefined) {
  if (seconds === undefined) return undefined;
  if (seconds < 0.001) return `${Math.round(seconds * 1_000_000)} µs`;
  if (seconds < 1) return `${(seconds * 1_000).toFixed(2)} ms`;
  return `${seconds.toFixed(2)} s`;
}

function outcomeLabel(observation: DnsObservation) {
  return DNS_OUTCOME_LABELS[observation.outcome];
}

async function copyRaw(item: DnsObservation | DnsRelatedEvidence) {
  try {
    await navigator.clipboard.writeText(rawJson(item));
    toast.add({
      title: "Raw message copied",
      color: "success",
      icon: "i-lucide-copy-check",
    });
  } catch {
    toast.add({
      title: "Could not copy raw message",
      color: "error",
      icon: "i-lucide-circle-alert",
    });
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="modalTitle"
    :ui="{
      content:
        'h-[min(46rem,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-5xl select-none sm:h-[min(46rem,calc(100dvh-4rem))]',
      body: 'min-h-0 flex-1 overflow-hidden select-none',
    }"
  >
    <template #body>
      <div v-if="entry" class="flex h-full min-h-0 flex-col">
        <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3 sm:gap-x-6">
          <div>
            <p class="text-xs text-brand-gray-500">DNS name or message</p>
            <p class="break-all font-mono">
              {{ entry.displayText ?? entry.queryName ?? "Not observed" }}
            </p>
          </div>
          <div>
            <p class="text-xs text-brand-gray-500">Type</p>
            <p>
              {{ entry.queryType ?? "Not observed"
              }}<span v-if="entry.queryType && DNS_QUERY_TYPE_LABELS[entry.queryType]">
                — {{ DNS_QUERY_TYPE_LABELS[entry.queryType] }}</span
              >
            </p>
          </div>
          <div>
            <p class="text-xs text-brand-gray-500">Result</p>
            <p>{{ DNS_OUTCOME_LABELS[entry.outcome] }}</p>
          </div>
          <div>
            <p class="text-xs text-brand-gray-500">Client</p>
            <p class="break-all font-mono">{{ entry.client || "-" }}</p>
          </div>
          <div>
            <p class="text-xs text-brand-gray-500">Path</p>
            <p>{{ entry.path }}</p>
          </div>
          <div>
            <p class="text-xs text-brand-gray-500">Correlation</p>
            <p>{{ entry.confidence }} · {{ entry.completeness }}</p>
          </div>
        </div>

        <div
          class="mt-5 min-h-0 flex-1 overflow-y-auto pr-1"
          :aria-busy="loading ? 'true' : 'false'"
        >
          <div
            v-if="loading"
            class="grid min-h-full place-items-center rounded-md border border-brand-gray-200 bg-brand-gray-50/60 p-8 dark:border-brand-gray-700 dark:bg-brand-gray-900/60"
          >
            <div role="status" class="space-y-3 text-center text-sm">
              <UIcon
                name="i-lucide-loader-circle"
                class="mx-auto size-7 animate-spin text-brand-blue-500"
              />
              <p>Loading DNS observations…</p>
            </div>
          </div>
          <p
            v-else-if="error"
            role="alert"
            class="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
          >
            {{ error }}
          </p>
          <div v-else-if="detail" class="space-y-5">
            <p
              v-if="detail.detailTruncated"
              class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              Detail observation limit reached. Flow is incomplete.
            </p>
            <p
              v-for="warning in detail.warnings"
              :key="warning"
              class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            >
              {{ warning }}
            </p>

            <section aria-labelledby="dns-flow-heading">
              <h3 id="dns-flow-heading" class="mb-2 text-sm font-semibold">Observed flow</h3>
              <ol class="space-y-2">
                <li
                  v-for="(observation, index) in observations"
                  :key="observation.id"
                  class="grid grid-cols-[2rem_1fr] items-start gap-3 rounded-md border border-brand-gray-200 p-3 text-sm dark:border-brand-gray-700"
                >
                  <span
                    aria-hidden="true"
                    class="grid size-7 place-items-center rounded-full bg-brand-blue-100 text-xs font-semibold text-brand-blue-900 dark:bg-brand-blue-900 dark:text-brand-blue-100"
                    >{{ index + 1 }}</span
                  >
                  <div class="grid min-w-0 gap-1 sm:grid-cols-[8rem_10rem_1fr] sm:gap-3">
                    <span class="capitalize">{{ stageLabel(observation) }}</span>
                    <span class="text-brand-gray-600 dark:text-brand-gray-300">
                      {{ stageActor(observation) }}
                    </span>
                    <div class="min-w-0">
                      <p class="text-xs text-brand-gray-500">Event time</p>
                      <NuxtTime
                        :datetime="observation.timestamp"
                        date-style="medium"
                        time-style="medium"
                        :hour-cycle="hourCycle"
                      />
                      <template v-if="observation.enqueuedTimeUtc">
                        <p class="mt-1 text-xs text-brand-gray-500">Event Hub enqueued</p>
                        <NuxtTime
                          :datetime="observation.enqueuedTimeUtc"
                          date-style="medium"
                          time-style="medium"
                          :hour-cycle="hourCycle"
                        />
                      </template>
                      <p v-if="observation.serverIp" class="truncate font-mono text-xs">
                        Server {{ observation.serverIp
                        }}<span v-if="observation.serverPort">:{{ observation.serverPort }}</span>
                      </p>
                      <p>{{ outcomeLabel(observation) }}</p>
                    </div>
                  </div>
                </li>
              </ol>
              <p
                v-if="
                  entry.source === 'proxy-structured' &&
                  !observations.some((observation) => observation.stage === 'proxy-exchange')
                "
                class="mt-2 text-sm text-brand-gray-600 dark:text-brand-gray-300"
              >
                Not observed: terminal response.
              </p>
            </section>

            <section
              v-for="observation in observations"
              :key="`${observation.id}-decoded`"
              class="space-y-3"
            >
              <h3 class="text-sm font-semibold">Decoded fields</h3>
              <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <dt class="text-xs text-brand-gray-500">Source</dt>
                  <dd>{{ observation.source }}</dd>
                </div>
                <div v-if="observation.protocol">
                  <dt class="text-xs text-brand-gray-500">Protocol</dt>
                  <dd>{{ observation.protocol }}</dd>
                </div>
                <div v-if="observation.action">
                  <dt class="text-xs text-brand-gray-500">Firewall action</dt>
                  <dd>{{ observation.action }}</dd>
                </div>
                <div v-if="observation.clientIp">
                  <dt class="text-xs text-brand-gray-500">Client endpoint</dt>
                  <dd class="break-all font-mono">
                    {{ observation.clientIp
                    }}<span v-if="observation.clientPort">:{{ observation.clientPort }}</span>
                  </dd>
                </div>
                <div v-if="observation.serverIp">
                  <dt class="text-xs text-brand-gray-500">Destination endpoint</dt>
                  <dd class="break-all font-mono">
                    {{ observation.serverIp
                    }}<span v-if="observation.serverPort">:{{ observation.serverPort }}</span>
                  </dd>
                </div>
                <div v-if="observation.responseCode">
                  <dt class="text-xs text-brand-gray-500">Response code</dt>
                  <dd>
                    {{ observation.responseCode }}
                    <span v-if="DNS_RCODE_LABELS[observation.responseCode]">
                      — {{ DNS_RCODE_LABELS[observation.responseCode] }}</span
                    >
                  </dd>
                </div>
                <div v-if="observation.queryClass">
                  <dt class="text-xs text-brand-gray-500">Query class</dt>
                  <dd>
                    {{ observation.queryClass }}
                    <span v-if="DNS_CLASS_LABELS[observation.queryClass]">
                      — {{ DNS_CLASS_LABELS[observation.queryClass] }}</span
                    >
                  </dd>
                </div>
                <div v-if="observation.requestSizeBytes !== undefined">
                  <dt class="text-xs text-brand-gray-500">Request size</dt>
                  <dd>{{ observation.requestSizeBytes }} bytes</dd>
                </div>
                <div v-if="observation.responseSizeBytes !== undefined">
                  <dt class="text-xs text-brand-gray-500">Response size</dt>
                  <dd>{{ observation.responseSizeBytes }} bytes, not TTL</dd>
                </div>
                <div v-if="observation.ednsBufferSizeBytes !== undefined">
                  <dt class="text-xs text-brand-gray-500">EDNS0 buffer</dt>
                  <dd>{{ observation.ednsBufferSizeBytes }} bytes</dd>
                </div>
                <div v-if="observation.dnssecOk !== undefined">
                  <dt class="text-xs text-brand-gray-500">DNSSEC OK</dt>
                  <dd>{{ observation.dnssecOk ? "Set" : "Not set" }}</dd>
                </div>
                <div v-if="observation.durationSeconds !== undefined">
                  <dt class="text-xs text-brand-gray-500">Azure-reported transaction duration</dt>
                  <dd>
                    {{ duration(observation.durationSeconds) }} ·
                    {{ observation.durationSeconds }} s exact
                  </dd>
                </div>
                <div v-if="observation.errorNumber">
                  <dt class="text-xs text-brand-gray-500">Error number</dt>
                  <dd>{{ observation.errorNumber }}</dd>
                </div>
                <div v-if="observation.errorMessage">
                  <dt class="text-xs text-brand-gray-500">Error message</dt>
                  <dd>{{ observation.errorMessage }}</dd>
                </div>
                <div v-if="observation.msgType">
                  <dt class="text-xs text-brand-gray-500">Message type</dt>
                  <dd>{{ observation.msgType }}</dd>
                </div>
                <div v-if="observation.queryMessage" class="sm:col-span-2 lg:col-span-3">
                  <dt class="text-xs text-brand-gray-500">Query message</dt>
                  <dd class="break-all font-mono text-xs">{{ observation.queryMessage }}</dd>
                </div>
                <div v-if="observation.serverMessage" class="sm:col-span-2 lg:col-span-3">
                  <dt class="text-xs text-brand-gray-500">Server message</dt>
                  <dd class="break-all font-mono text-xs">{{ observation.serverMessage }}</dd>
                </div>
                <div v-if="observation.queryTime">
                  <dt class="text-xs text-brand-gray-500">Azure query time</dt>
                  <dd>{{ observation.queryTime }}</dd>
                </div>
                <div v-if="observation.responseTime">
                  <dt class="text-xs text-brand-gray-500">Azure response time</dt>
                  <dd>{{ observation.responseTime }}</dd>
                </div>
                <div v-if="observation.socketFamily">
                  <dt class="text-xs text-brand-gray-500">Socket family</dt>
                  <dd>{{ observation.socketFamily }}</dd>
                </div>
                <div v-if="observation.policy">
                  <dt class="text-xs text-brand-gray-500">Firewall policy</dt>
                  <dd>{{ observation.policy }}</dd>
                </div>
                <div v-if="observation.ruleCollectionGroup">
                  <dt class="text-xs text-brand-gray-500">Rule collection group</dt>
                  <dd>{{ observation.ruleCollectionGroup }}</dd>
                </div>
                <div v-if="observation.ruleCollection">
                  <dt class="text-xs text-brand-gray-500">Rule collection</dt>
                  <dd>{{ observation.ruleCollection }}</dd>
                </div>
                <div v-if="observation.rule">
                  <dt class="text-xs text-brand-gray-500">Rule</dt>
                  <dd>{{ observation.rule }}</dd>
                </div>
                <div v-if="observation.resourceId" class="sm:col-span-2 lg:col-span-3">
                  <dt class="text-xs text-brand-gray-500">Azure resource</dt>
                  <dd class="break-all font-mono text-xs">{{ observation.resourceId }}</dd>
                </div>
                <div v-for="flag in observation.responseFlags" :key="flag">
                  <dt class="text-xs text-brand-gray-500">Flag {{ flag }}</dt>
                  <dd>{{ DNS_FLAG_LABELS[flag.toLowerCase()] ?? "Unknown flag" }}</dd>
                </div>
              </dl>
            </section>

            <section
              v-if="detail.relatedSources?.length"
              aria-labelledby="dns-related-heading"
              class="space-y-3"
            >
              <div>
                <h3 id="dns-related-heading" class="text-sm font-semibold">
                  Nearby firewall evidence
                </h3>
                <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                  Fixed-window matches from same firewall and available endpoint or FQDN anchors.
                  Azure provides no explicit correlation ID; these records are not asserted to
                  belong to this DNS transaction.
                </p>
              </div>
              <ul class="grid gap-2 text-xs sm:grid-cols-3">
                <li
                  v-for="source in detail.relatedSources"
                  :key="source.source"
                  class="rounded-md border border-brand-gray-200 p-2 dark:border-brand-gray-700"
                >
                  <span class="font-medium">{{ relatedSourceLabels[source.source] }}</span>
                  <span class="ml-1 text-brand-gray-600 dark:text-brand-gray-300">
                    · {{ source.availability
                    }}<template v-if="source.truncated"> · truncated</template>
                  </span>
                  <p v-if="source.warning" class="mt-1 text-amber-700 dark:text-amber-300">
                    {{ source.warning }}
                  </p>
                </li>
              </ul>
              <p
                v-if="relatedEvidence.length === 0"
                class="text-sm text-brand-gray-600 dark:text-brand-gray-300"
              >
                No nearby firewall evidence matched available anchors.
              </p>
              <article
                v-for="evidence in relatedEvidence"
                :key="evidence.id"
                class="space-y-3 rounded-md border border-brand-gray-200 p-3 text-sm dark:border-brand-gray-700"
              >
                <div>
                  <p class="font-medium">{{ relatedSourceLabels[evidence.source] }}</p>
                  <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                    Matched on {{ evidence.matchBasis }}. Uncorrelated nearby evidence.
                  </p>
                </div>
                <dl class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <dt class="text-xs text-brand-gray-500">Event time</dt>
                    <dd>
                      <NuxtTime
                        :datetime="evidence.timestamp"
                        date-style="medium"
                        time-style="medium"
                        :hour-cycle="hourCycle"
                      />
                    </dd>
                  </div>
                  <div v-if="evidence.action">
                    <dt class="text-xs text-brand-gray-500">Action</dt>
                    <dd>
                      {{ evidence.action
                      }}<span v-if="evidence.actionReason"> · {{ evidence.actionReason }}</span>
                    </dd>
                  </div>
                  <div v-if="evidence.flag">
                    <dt class="text-xs text-brand-gray-500">TCP flag</dt>
                    <dd>{{ evidence.flag }}</dd>
                  </div>
                  <div v-if="evidence.queryName">
                    <dt class="text-xs text-brand-gray-500">FQDN</dt>
                    <dd class="break-all font-mono text-xs">{{ evidence.queryName }}</dd>
                  </div>
                  <div v-if="evidence.targetUrl" class="sm:col-span-2">
                    <dt class="text-xs text-brand-gray-500">Target URL</dt>
                    <dd class="break-all font-mono text-xs">{{ evidence.targetUrl }}</dd>
                  </div>
                  <div v-if="evidence.translatedIp">
                    <dt class="text-xs text-brand-gray-500">Translated endpoint</dt>
                    <dd class="font-mono text-xs">
                      {{ evidence.translatedIp
                      }}<span v-if="evidence.translatedPort">:{{ evidence.translatedPort }}</span>
                    </dd>
                  </div>
                </dl>
                <details>
                  <summary class="cursor-pointer text-xs font-medium">Raw related record</summary>
                  <textarea
                    :value="rawJson(evidence)"
                    :rows="rawRowCount(evidence)"
                    readonly
                    spellcheck="false"
                    wrap="off"
                    class="mt-2 block max-h-96 w-full resize-none overflow-auto border-0 bg-brand-gray-50 p-3 font-mono text-xs leading-5 select-text text-brand-gray-950 focus:outline-none dark:bg-brand-gray-900 dark:text-brand-gray-50"
                  />
                </details>
              </article>
            </section>

            <section
              v-for="(observation, index) in observations"
              :key="`${observation.id}-raw`"
              class="rounded-md border border-brand-gray-200 bg-brand-gray-50 dark:border-brand-gray-700 dark:bg-brand-gray-900"
            >
              <div
                class="flex items-center justify-between border-b border-brand-gray-200 px-3 py-2 dark:border-brand-gray-700"
              >
                <h3 class="text-xs font-semibold text-brand-gray-700 dark:text-brand-gray-200">
                  Raw message<span v-if="observations.length > 1">
                    {{ index + 1 }} · {{ stageLabel(observation) }}</span
                  >
                </h3>
                <UButton
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  icon="i-lucide-copy"
                  label="Copy raw"
                  :aria-label="
                    observations.length > 1 ? `Copy raw message ${index + 1}` : 'Copy raw'
                  "
                  @click="copyRaw(observation)"
                />
              </div>
              <textarea
                :value="rawJson(observation)"
                :rows="rawRowCount(observation)"
                :aria-label="observations.length > 1 ? `Raw message ${index + 1}` : 'Raw message'"
                readonly
                spellcheck="false"
                wrap="off"
                class="block max-h-96 w-full resize-none overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-5 select-text text-brand-gray-950 focus:outline-none dark:text-brand-gray-50"
              />
            </section>
          </div>
        </div>
      </div>
    </template>
  </UModal>
</template>
