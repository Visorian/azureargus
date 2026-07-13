<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";

import type {
  DnsEntry,
  DnsFilterOptions,
  DnsFilters,
  DnsObservation,
  DnsSort,
  DnsSourceStatus,
} from "#shared/types/dns";

const props = defineProps<{
  entries: DnsEntry[];
  transports: DnsObservation[];
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
  selectTransport: [observation: DnsObservation];
}>();
const filters = defineModel<DnsFilters>("filters", { required: true });
const sort = defineModel<DnsSort>("sort", { required: true });
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
  { label: "Shortest duration first", value: "duration-asc", key: "duration", direction: "asc" },
  { label: "Longest duration first", value: "duration-desc", key: "duration", direction: "desc" },
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
const outcomeFilter = filterModel("outcome");
const sourceFilter = filterModel("source");

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
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
    <div
      class="grid shrink-0 grid-cols-1 gap-2 md:grid-cols-3 xl:grid-cols-7"
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
        :items="filterOptions.outcomes"
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
    <div class="flex shrink-0 flex-wrap items-center gap-2">
      <UButton
        v-if="logAnalysis"
        label="Apply filters"
        icon="i-lucide-filter"
        :loading="status === 'loading'"
        :disabled="!canApplyFilters"
        @click="emit('apply')"
      />
      <UButton label="Reset filters" color="neutral" variant="outline" @click="emit('reset')" />
      <span
        role="status"
        aria-live="polite"
        class="text-xs text-brand-gray-600 dark:text-brand-gray-300"
      >
        {{ entries.length }} queried entries · {{ transports.length }} unidentified transports
      </span>
    </div>

    <p
      v-if="error"
      role="alert"
      class="shrink-0 rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
    >
      {{ error }}
    </p>

    <div
      v-if="sources.some((source) => source.availability !== 'available')"
      class="shrink-0 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p
        v-for="source in sources.filter((item) => item.availability !== 'available')"
        :key="source.source"
      >
        {{ source.source }}: {{ source.availability
        }}<span v-if="source.warning"> — {{ source.warning }}</span>
      </p>
    </div>

    <section
      class="flex min-h-52 flex-1 flex-col overflow-hidden rounded-md border border-brand-gray-200 dark:border-brand-gray-700"
      aria-labelledby="dns-entry-heading"
    >
      <h2
        id="dns-entry-heading"
        class="flex shrink-0 items-center justify-between border-b border-brand-gray-200 px-3 py-2 text-sm font-semibold dark:border-brand-gray-700"
      >
        <span>Queried entries</span>
        <UBadge v-if="entriesTruncated" color="warning" variant="subtle">
          Entries truncated
        </UBadge>
      </h2>
      <div class="flex min-h-0 flex-1 flex-col overflow-x-auto" data-testid="dns-entry-scroll">
        <div
          class="sticky top-0 z-10 grid min-w-278 shrink-0 grid-cols-[6.5rem_minmax(9rem,1fr)_3.5rem_24rem_4rem_7rem_5.5rem_5rem] gap-2 border-b border-brand-gray-200 bg-brand-gray-50 px-3 py-2 text-xs font-semibold dark:border-brand-gray-700 dark:bg-brand-gray-900"
          data-testid="dns-entry-header"
        >
          <span>Time</span>
          <span>Query name</span>
          <span>Type</span>
          <span>Client</span>
          <span>Path</span>
          <span>Result</span>
          <span>Duration</span>
          <span>Observations</span>
        </div>
        <ClientOnly>
          <RecycleScroller
            v-if="entries.length"
            :items="entries"
            :item-size="44"
            key-field="id"
            class="min-h-0 min-w-278 flex-1"
            role="list"
          >
            <template #default="{ item }">
              <button
                type="button"
                class="grid h-11 w-full min-w-278 grid-cols-[6.5rem_minmax(9rem,1fr)_3.5rem_24rem_4rem_7rem_5.5rem_5rem] items-center gap-2 border-b border-brand-gray-100 px-3 text-left text-xs hover:bg-brand-gray-50 focus-visible:outline-2 focus-visible:outline-brand-blue-500 dark:border-brand-gray-800 dark:hover:bg-brand-gray-900"
                :aria-label="`Open DNS details for ${item.queryName ?? 'unknown query'}`"
                :aria-pressed="selectedEntryId === item.id"
                @click="emit('select', item)"
              >
                <NuxtTime
                  :datetime="item.timestamp"
                  hour="2-digit"
                  minute="2-digit"
                  second="2-digit"
                />
                <span class="truncate font-mono">{{ item.queryName ?? "Unknown query" }}</span>
                <span>{{ item.queryType ?? "-" }}</span>
                <span class="whitespace-nowrap font-mono">{{ item.client || "-" }}</span>
                <span>{{ item.path }}</span>
                <span>{{ item.outcome }}</span>
                <span>{{ duration(item.durationSeconds) }}</span>
                <span>{{ item.observationCount }}</span>
              </button>
            </template>
          </RecycleScroller>
          <div
            v-else
            class="grid min-h-52 min-w-278 flex-1 place-items-center p-8 text-center text-sm text-brand-gray-600 dark:text-brand-gray-300"
          >
            {{
              status === "idle" && logAnalysis
                ? "Run DNS query to load entries."
                : "No matching DNS entries."
            }}
          </div>
        </ClientOnly>
      </div>
    </section>

    <section
      class="flex max-h-64 min-h-32 flex-col overflow-hidden rounded-md border border-brand-gray-200 dark:border-brand-gray-700"
      aria-labelledby="dns-transport-heading"
    >
      <h2
        id="dns-transport-heading"
        class="flex shrink-0 items-center justify-between border-b border-brand-gray-200 px-3 py-2 text-sm font-semibold dark:border-brand-gray-700"
      >
        <span>Unidentified DNS transport</span>
        <UBadge v-if="transportsTruncated" color="warning" variant="subtle">
          Transport truncated
        </UBadge>
      </h2>
      <div class="flex min-h-0 flex-1 flex-col overflow-x-auto" data-testid="dns-transport-scroll">
        <div
          class="sticky top-0 z-10 grid min-w-251 shrink-0 grid-cols-[10rem_24rem_minmax(11.25rem,1fr)_6rem_8rem] gap-2 border-b border-brand-gray-200 bg-brand-gray-50 px-3 py-2 text-xs font-semibold dark:border-brand-gray-700 dark:bg-brand-gray-900"
          data-testid="dns-transport-header"
        >
          <span>Time</span>
          <span>Client</span>
          <span>Destination</span>
          <span>Protocol</span>
          <span>Result</span>
        </div>
        <ClientOnly>
          <RecycleScroller
            v-if="transports.length"
            :items="transports"
            :item-size="40"
            key-field="id"
            class="min-h-0 min-w-251 flex-1"
            role="list"
          >
            <template #default="{ item }">
              <button
                type="button"
                class="grid h-10 w-full min-w-251 grid-cols-[10rem_24rem_minmax(11.25rem,1fr)_6rem_8rem] items-center gap-2 border-b border-brand-gray-100 px-3 text-left text-xs hover:bg-brand-gray-50 focus-visible:outline-2 focus-visible:outline-brand-blue-500 dark:border-brand-gray-800 dark:hover:bg-brand-gray-900"
                :aria-label="`Open DNS transport details for ${endpoint(item, 'client')}`"
                :aria-pressed="selectedEntryId === item.id"
                @click="emit('selectTransport', item)"
              >
                <NuxtTime
                  :datetime="item.timestamp"
                  hour="2-digit"
                  minute="2-digit"
                  second="2-digit"
                />
                <span class="whitespace-nowrap font-mono">{{ endpoint(item, "client") }}</span>
                <span class="truncate font-mono">{{ endpoint(item, "server") }}</span>
                <span>{{ item.protocol ?? "-" }}</span>
                <span>{{ item.outcome }}</span>
              </button>
            </template>
          </RecycleScroller>
          <p v-else class="min-w-251 p-4 text-sm text-brand-gray-600 dark:text-brand-gray-300">
            No unidentified port-53 transport observations.
          </p>
        </ClientOnly>
      </div>
    </section>
  </div>
</template>
