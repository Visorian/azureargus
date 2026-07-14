<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";

import type {
  DnsEntry,
  DnsFilterOptions,
  DnsFilters,
  DnsObservation,
  DnsOutcome,
  DnsSort,
  DnsSourceStatus,
} from "#shared/types/dns";
import { DNS_OUTCOME_LABELS } from "#shared/utils/dns";

const props = defineProps<{
  entries: DnsEntry[];
  sources: DnsSourceStatus[];
  status: "idle" | "loading" | "success" | "error";
  error: string | null;
  entriesTruncated: boolean;
  transportsTruncated: boolean;
  logAnalysis: boolean;
  canApplyFilters: boolean;
  filterOptions: DnsFilterOptions;
  selectedEntryId: string | null;
}>();
const emit = defineEmits<{
  apply: [];
  reset: [];
  select: [entry: DnsEntry];
}>();
const filters = defineModel<DnsFilters>("filters", { required: true });
const sort = defineModel<DnsSort>("sort", { required: true });
const showUnidentifiedTransports = defineModel<boolean>("showUnidentifiedTransports", {
  required: true,
});
const dnsEntryGridClass =
  "min-w-394 grid-cols-[6.5rem_minmax(9rem,1fr)_3.5rem_4rem_24rem_18rem_4rem_7rem_5.5rem_5.5rem_5rem]";
type SortSelection =
  | "timestamp-desc"
  | "timestamp-asc"
  | "queryName-asc"
  | "queryName-desc"
  | "duration-asc"
  | "duration-desc"
  | "observations-asc"
  | "observations-desc";
const sortItems = [
  { label: "Newest first", value: "timestamp-desc", key: "timestamp", direction: "desc" },
  { label: "Oldest first", value: "timestamp-asc", key: "timestamp", direction: "asc" },
  { label: "Query name A–Z", value: "queryName-asc", key: "queryName", direction: "asc" },
  { label: "Query name Z–A", value: "queryName-desc", key: "queryName", direction: "desc" },
  {
    label: "Shortest transaction first",
    value: "duration-asc",
    key: "duration",
    direction: "asc",
  },
  {
    label: "Longest transaction first",
    value: "duration-desc",
    key: "duration",
    direction: "desc",
  },
  {
    label: "Fewest observations first",
    value: "observations-asc",
    key: "observations",
    direction: "asc",
  },
  {
    label: "Most observations first",
    value: "observations-desc",
    key: "observations",
    direction: "desc",
  },
] satisfies Array<{
  label: string;
  value: SortSelection;
  key: DnsSort["key"];
  direction: DnsSort["direction"];
}>;

function selectedSortValue(value: DnsSort): SortSelection {
  if (value.key === "timestamp")
    return value.direction === "desc" ? "timestamp-desc" : "timestamp-asc";
  if (value.key === "queryName")
    return value.direction === "asc" ? "queryName-asc" : "queryName-desc";
  if (value.key === "duration") return value.direction === "asc" ? "duration-asc" : "duration-desc";
  return value.direction === "asc" ? "observations-asc" : "observations-desc";
}

const sortSelection = computed<SortSelection>({
  get: () => selectedSortValue(sort.value),
  set: (value) => {
    const selected = sortItems.find((item) => item.value === value);
    if (!selected) return;
    sort.value = { key: selected.key, direction: selected.direction };
  },
});

function filterModel(key: "queryType" | "protocol" | "outcome" | "source") {
  return computed<string | null>({
    get: () => filters.value[key] || null,
    set: (value) => {
      filters.value[key] = value ?? "";
    },
  });
}

const queryTypeFilter = filterModel("queryType");
const protocolFilter = filterModel("protocol");
const sourceFilter = filterModel("source");

function isDnsOutcome(value: string): value is DnsOutcome {
  return Object.hasOwn(DNS_OUTCOME_LABELS, value);
}

const outcomeFilter = computed<DnsOutcome | null>({
  get: () => (isDnsOutcome(filters.value.outcome) ? filters.value.outcome : null),
  set: (value) => {
    filters.value.outcome = value ?? "";
  },
});
const outcomeItems = computed(() =>
  props.filterOptions.outcomes.map((value) => ({
    label: DNS_OUTCOME_LABELS[value],
    value,
  })),
);
const emptyEntryMessage = computed(() => {
  if (props.status === "loading") return "Loading DNS entries…";
  if (props.error) return "DNS query failed.";
  if (props.status === "idle" && props.logAnalysis) return "Run DNS query to load entries.";
  const unavailable = props.sources.filter((source) => source.availability !== "available");
  if (props.sources.length > 0 && unavailable.length === props.sources.length) {
    return "No DNS sources are available for this query.";
  }
  if (unavailable.length > 0) return "No entries returned by available DNS sources.";
  if (props.entriesTruncated) return "No entries retained within bounded DNS query results.";
  return "No matching DNS entries.";
});
const sourceWarnings = computed(() =>
  props.sources
    .filter((source) => source.availability !== "available")
    .map((source) => ({
      key: source.source,
      text: source.warning ?? `${source.source} source unavailable`,
    })),
);

function outcomeLabel(value: DnsEntry["outcome"]) {
  return DNS_OUTCOME_LABELS[value];
}

function duration(seconds: number | undefined) {
  if (seconds === undefined) return "-";
  if (seconds < 0.001) return `${Math.round(seconds * 1_000_000)} µs`;
  if (seconds < 1) return `${(seconds * 1_000).toFixed(2)} ms`;
  return `${seconds.toFixed(2)} s`;
}

function endpoint(observation: DnsObservation, side: "client" | "server") {
  const ip = side === "client" ? observation.clientIp : observation.serverIp;
  const port = side === "client" ? observation.clientPort : observation.serverPort;
  return [ip, port].filter(Boolean).join(":") || "-";
}

function destination(entry: DnsEntry) {
  if (entry.destination) return entry.destination;
  const observation = entry.observations.find(
    (item) => Boolean(item.serverIp) || Boolean(item.serverPort),
  );
  return observation ? endpoint(observation, "server") : "-";
}

function completeness(value: DnsEntry["completeness"]) {
  return value
    .split("-")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <LogsLogAnalysisToolbar>
      <template #filters>
        <div
          class="grid min-w-0 flex-1 basis-full grid-cols-1 gap-2 md:grid-cols-3 xl:basis-0 xl:grid-cols-7"
          data-testid="dns-filter-grid"
        >
          <UInput
            v-model="filters.search"
            aria-label="Domain or DNS search"
            placeholder="Domain or text"
          />
          <USelectMenu
            v-model="queryTypeFilter"
            :items="filterOptions.queryTypes"
            aria-label="Query type"
            clear
            placeholder="Query type"
          />
          <UInput v-model="filters.client" aria-label="DNS client" placeholder="Client" />
          <USelectMenu
            v-model="protocolFilter"
            :items="filterOptions.protocols"
            aria-label="DNS protocol"
            clear
            placeholder="Protocol"
          />
          <USelectMenu
            v-model="outcomeFilter"
            :items="outcomeItems"
            value-key="value"
            aria-label="DNS result"
            clear
            placeholder="Result"
          />
          <USelectMenu
            v-model="sourceFilter"
            :items="filterOptions.sources"
            aria-label="DNS source"
            clear
            placeholder="Source"
          />
          <USelect v-model="sortSelection" :items="sortItems" aria-label="DNS sort order" />
        </div>
        <div class="flex h-8 shrink-0 items-center px-1">
          <UCheckbox v-model="showUnidentifiedTransports" label="Show unidentified DNS transport" />
        </div>
        <LogsLogFilterActions
          :show-apply="logAnalysis"
          :apply-disabled="!canApplyFilters"
          :apply-loading="status === 'loading'"
          @apply="emit('apply')"
          @reset="emit('reset')"
        />
      </template>
      <template v-if="$slots['query-controls']" #query>
        <slot name="query-controls" />
      </template>
    </LogsLogAnalysisToolbar>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <p
        v-if="error"
        role="alert"
        class="shrink-0 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
      >
        {{ error }}
      </p>
      <div
        v-if="sourceWarnings.length"
        role="status"
        class="shrink-0 rounded-md bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100"
      >
        <p class="font-medium">Some DNS sources could not be queried.</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="warning in sourceWarnings" :key="warning.key">{{ warning.text }}</li>
        </ul>
      </div>

      <section
        class="flex min-h-52 flex-1 flex-col overflow-hidden rounded-md border border-brand-gray-200 dark:border-brand-gray-700"
        aria-labelledby="dns-entry-heading"
      >
        <h2
          id="dns-entry-heading"
          class="flex shrink-0 items-center justify-between border-b border-brand-gray-200 px-3 py-2 text-sm font-semibold dark:border-brand-gray-700"
        >
          <span>DNS activity</span>
          <span class="flex items-center gap-2">
            <UBadge v-if="entriesTruncated" color="warning" variant="subtle">
              Entries truncated
            </UBadge>
            <UBadge v-if="transportsTruncated" color="warning" variant="subtle">
              Unidentified transport truncated
            </UBadge>
          </span>
        </h2>
        <div class="flex min-h-0 flex-1 flex-col overflow-x-auto" data-testid="dns-entry-scroll">
          <div
            class="sticky top-0 z-10 grid shrink-0 gap-2 border-b border-brand-gray-200 bg-brand-gray-50 px-3 py-2 text-xs font-semibold dark:border-brand-gray-700 dark:bg-brand-gray-900"
            :class="dnsEntryGridClass"
            data-testid="dns-entry-header"
          >
            <span>Time</span>
            <span>DNS name or message</span>
            <span>Type</span>
            <span>Protocol</span>
            <span>Client</span>
            <span>Destination</span>
            <span>Path</span>
            <span>Result</span>
            <span>Transaction duration</span>
            <span>Evidence</span>
            <span>Observations</span>
          </div>
          <ClientOnly>
            <RecycleScroller
              v-if="entries.length"
              :items="entries"
              :item-size="44"
              key-field="id"
              class="min-h-0 min-w-394 flex-1"
            >
              <template #default="{ item }">
                <button
                  type="button"
                  class="grid h-11 w-full items-center gap-2 border-b border-brand-gray-100 px-3 text-left text-xs hover:bg-brand-gray-50 focus-visible:outline-2 focus-visible:outline-brand-blue-500 dark:border-brand-gray-800 dark:hover:bg-brand-gray-900"
                  :class="dnsEntryGridClass"
                  :aria-label="
                    item.source !== 'network-rule'
                      ? `Open DNS details for ${item.displayText || item.queryName || item.source}`
                      : `Open DNS transport details for ${item.client || 'unknown client'}`
                  "
                  :aria-pressed="selectedEntryId === item.id"
                  @click="emit('select', item)"
                >
                  <NuxtTime
                    :datetime="item.timestamp"
                    hour="2-digit"
                    minute="2-digit"
                    second="2-digit"
                  />
                  <span class="truncate font-mono">{{
                    item.displayText ?? item.queryName ?? "Not observed"
                  }}</span>
                  <span>{{ item.queryType ?? "-" }}</span>
                  <span>{{ item.protocol ?? "-" }}</span>
                  <span class="truncate font-mono" :title="item.client || '-'">
                    {{ item.client || "-" }}
                  </span>
                  <span class="truncate font-mono" :title="destination(item)">
                    {{ destination(item) }}
                  </span>
                  <span>{{ item.path }}</span>
                  <span>{{ outcomeLabel(item.outcome) }}</span>
                  <span>{{ duration(item.durationSeconds) }}</span>
                  <span>{{ completeness(item.completeness) }}</span>
                  <span>{{ item.observationCount }}</span>
                </button>
              </template>
            </RecycleScroller>
            <div
              v-else
              class="grid min-h-52 min-w-394 flex-1 place-items-center p-8 text-center text-sm text-brand-gray-600 dark:text-brand-gray-300"
            >
              {{ emptyEntryMessage }}
            </div>
          </ClientOnly>
        </div>
      </section>
    </div>
  </div>
</template>
