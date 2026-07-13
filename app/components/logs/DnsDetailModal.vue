<script setup lang="ts">
import type {
  DnsDetailQueryResponse,
  DnsEntry,
  DnsObservation,
  DnsSourceStatus,
} from "#shared/types/dns";
import {
  DNS_CLASS_LABELS,
  DNS_FLAG_LABELS,
  DNS_QUERY_TYPE_LABELS,
  DNS_RCODE_LABELS,
} from "#shared/utils/dns";

const props = defineProps<{
  entry: DnsEntry | null;
  detail: DnsDetailQueryResponse | null;
  error: string | null;
  loading: boolean;
  sources: DnsSourceStatus[];
}>();
const open = defineModel<boolean>("open", { required: true });
const toast = useToast();
const transportOnly = computed(() => props.entry !== null && !props.entry.queryName);

function stageLabel(observation: DnsObservation) {
  if (observation.stage === "proxy-exchange") return "Proxy exchange";
  return observation.stage.replaceAll("-", " ");
}

function rawJson(observation: DnsObservation) {
  return JSON.stringify(observation.raw, null, 2);
}

function rawRowCount(observation: DnsObservation) {
  return Math.min(Math.max(rawJson(observation).split("\n").length, 6), 24);
}

function stageActor(observation: DnsObservation) {
  if (observation.stage === "client-query" || observation.stage === "client-response") {
    return "Client";
  }
  if (observation.stage === "forwarder-query" || observation.stage === "forwarder-response") {
    return "DNS server";
  }
  return "Azure Firewall";
}

function duration(seconds: number | undefined) {
  if (seconds === undefined) return undefined;
  if (seconds < 0.001) return `${Math.round(seconds * 1_000_000)} µs`;
  if (seconds < 1) return `${(seconds * 1_000).toFixed(2)} ms`;
  return `${seconds.toFixed(2)} s`;
}

async function copyRaw(observation: DnsObservation) {
  try {
    await navigator.clipboard.writeText(rawJson(observation));
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
    :title="transportOnly ? 'DNS transport detail' : 'DNS resolution detail'"
    :ui="{ content: 'sm:max-w-5xl select-none', body: 'select-none' }"
  >
    <template #body>
      <div v-if="entry" class="space-y-5">
        <div class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3 sm:gap-x-6">
          <div>
            <p class="text-xs text-brand-gray-500">Query</p>
            <p class="break-all font-mono">{{ entry.queryName ?? "Not observed" }}</p>
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
            <p>{{ entry.outcome }}</p>
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

        <p
          v-if="error"
          role="alert"
          class="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
        >
          {{ error }}
        </p>
        <p v-if="loading" role="status" class="text-sm">Loading DNS observations…</p>
        <p
          v-if="detail?.detailTruncated"
          class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          Detail observation limit reached. Flow is incomplete.
        </p>
        <div
          v-if="sources.some((source) => source.availability !== 'available')"
          class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          <p
            v-for="source in sources.filter((item) => item.availability !== 'available')"
            :key="source.source"
          >
            {{ source.source }}: {{ source.availability }}
          </p>
        </div>
        <p
          v-for="warning in detail?.warnings ?? entry.warnings"
          :key="warning"
          class="rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
        >
          {{ warning }}
        </p>

        <section aria-labelledby="dns-flow-heading">
          <h3 id="dns-flow-heading" class="mb-2 text-sm font-semibold">Observed flow</h3>
          <ol class="space-y-2">
            <li
              v-for="(observation, index) in detail?.observations ?? entry.observations"
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
                  <span v-if="observation.attempt"> · attempt {{ observation.attempt }}</span>
                </span>
                <div class="min-w-0">
                  <NuxtTime
                    :datetime="observation.timestamp"
                    hour="2-digit"
                    minute="2-digit"
                    second="2-digit"
                  />
                  <p v-if="observation.serverIp" class="truncate font-mono text-xs">
                    Server {{ observation.serverIp
                    }}<span v-if="observation.serverPort">:{{ observation.serverPort }}</span>
                  </p>
                  <p>{{ observation.outcome }}</p>
                </div>
              </div>
            </li>
          </ol>
          <p
            v-if="
              !(detail?.observations ?? entry.observations).some(
                (observation) =>
                  observation.stage === 'client-response' || observation.stage === 'proxy-exchange',
              )
            "
            class="mt-2 text-sm text-brand-gray-600 dark:text-brand-gray-300"
          >
            Not observed: terminal response.
          </p>
        </section>

        <section
          v-for="observation in detail?.observations ?? entry.observations"
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
              <dt class="text-xs text-brand-gray-500">Duration</dt>
              <dd>
                {{ duration(observation.durationSeconds) }} · {{ observation.durationSeconds }} s
                exact
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
            <div v-if="observation.queryTime">
              <dt class="text-xs text-brand-gray-500">Query time</dt>
              <dd>{{ observation.queryTime }}</dd>
            </div>
            <div v-if="observation.responseTime">
              <dt class="text-xs text-brand-gray-500">Response time</dt>
              <dd>{{ observation.responseTime }}</dd>
            </div>
            <div v-if="observation.queryMessage" class="sm:col-span-2 lg:col-span-3">
              <dt class="text-xs text-brand-gray-500">Query message</dt>
              <dd class="break-all font-mono text-xs">{{ observation.queryMessage }}</dd>
            </div>
            <div v-if="observation.serverMessage" class="sm:col-span-2 lg:col-span-3">
              <dt class="text-xs text-brand-gray-500">Server message</dt>
              <dd class="break-all font-mono text-xs">{{ observation.serverMessage }}</dd>
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
          v-for="(observation, index) in detail?.observations ?? entry.observations"
          :key="`${observation.id}-raw`"
          class="rounded-md border border-brand-gray-200 bg-brand-gray-50 dark:border-brand-gray-700 dark:bg-brand-gray-900"
        >
          <div
            class="flex items-center justify-between border-b border-brand-gray-200 px-3 py-2 dark:border-brand-gray-700"
          >
            <h3 class="text-xs font-semibold text-brand-gray-700 dark:text-brand-gray-200">
              Raw message<span v-if="(detail?.observations ?? entry.observations).length > 1">
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
                (detail?.observations ?? entry.observations).length > 1
                  ? `Copy raw message ${index + 1}`
                  : 'Copy raw'
              "
              @click="copyRaw(observation)"
            />
          </div>
          <textarea
            :value="rawJson(observation)"
            :rows="rawRowCount(observation)"
            :aria-label="
              (detail?.observations ?? entry.observations).length > 1
                ? `Raw message ${index + 1}`
                : 'Raw message'
            "
            readonly
            spellcheck="false"
            wrap="off"
            class="block max-h-96 w-full resize-none overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-5 select-text text-brand-gray-950 focus:outline-none dark:text-brand-gray-50"
          />
        </section>
      </div>
    </template>
  </UModal>
</template>
