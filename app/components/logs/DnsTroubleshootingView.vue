<script setup lang="ts">
import { useElementSize, useMediaQuery } from "@vueuse/core";
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
import type { MobileQueryState } from "~/components/logs/LogAnalysisToolbar.vue";
import type { LogHourCycle } from "~/composables/useLogTimeFormat";

const props = withDefaults(
  defineProps<{
    hourCycle?: LogHourCycle;
    timeZone?: string;
    entries: DnsEntry[];
    sources: DnsSourceStatus[];
    status: "idle" | "loading" | "success" | "error";
    error: string | null;
    entriesTruncated: boolean;
    transportsTruncated: boolean;
    logAnalysis: boolean;
    canApplyFilters: boolean;
    queryState?: MobileQueryState | null;
    filterOptions: DnsFilterOptions;
    selectedEntryId: string | null;
  }>(),
  { hourCycle: "h23", timeZone: "UTC", queryState: null },
);
const emit = defineEmits<{
  interaction: [event: Event];
  run: [];
  settings: [event: MouseEvent];
  apply: [];
  reset: [];
  select: [entry: DnsEntry];
}>();
const filters = defineModel<DnsFilters>("filters", { required: true });
const sort = defineModel<DnsSort>("sort", { required: true });
const showUnidentifiedTransports = defineModel<boolean>("showUnidentifiedTransports", {
  required: true,
});
defineSlots<{
  "query-controls"?: (props: { mobile: boolean }) => unknown;
}>();
const isMobile = useMediaQuery("(max-width: 1023px)");
const tablet = useMediaQuery("(min-width: 768px)");
const entryViewport = useTemplateRef("entryViewport");
const { width: entryWidth } = useElementSize(entryViewport);
const mobileColumns = computed(() => (tablet.value ? 2 : 1));
const toolbar = useTemplateRef("toolbar");
const root = useTemplateRef("root");
let selectedTriggerId = "";
const activeFilterCount = computed(
  () =>
    Object.entries(filters.value).filter(([key, value]) => key !== "search" && value.trim() !== "")
      .length,
);
const dnsEntryGridClass = computed(() =>
  props.hourCycle === "h12"
    ? "min-w-394 grid-cols-[7.5rem_minmax(9rem,1fr)_3.5rem_4rem_24rem_18rem_4rem_7rem_5.5rem_5.5rem_5rem]"
    : "min-w-394 grid-cols-[6.5rem_minmax(9rem,1fr)_3.5rem_4rem_24rem_18rem_4rem_7rem_5.5rem_5.5rem_5rem]",
);
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

function selectEntry(entry: DnsEntry) {
  selectedTriggerId = entry.id;
  emit("select", entry);
}

function restoreFocus() {
  const target =
    root.value?.querySelector<HTMLElement>(`[data-dns-entry="${CSS.escape(selectedTriggerId)}"]`) ??
    root.value?.querySelector<HTMLInputElement>("input");
  target?.focus({ preventScroll: true });
}

defineExpose({ restoreFocus });

function openQuery(event: MouseEvent) {
  if (props.queryState?.canRun) {
    toolbar.value?.openFilters();
  } else {
    emit("settings", event);
  }
}

function outcomeClass(value: DnsEntry["outcome"]) {
  if (value === "dns-error" || value === "blocked" || value === "transport-error") {
    return "text-red-700 dark:text-red-400";
  }
  if (value === "pending") {
    return "text-amber-800 dark:text-amber-300";
  }
  return "text-default";
}

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
  <div ref="root" class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <LogsLogAnalysisToolbar
      ref="toolbar"
      :result-count="entries.length"
      :query-state="queryState"
      :active-filter-count="activeFilterCount"
      @run="emit('run')"
      @interaction="emit('interaction', $event)"
    >
      <template #search>
        <UInput
          v-model="filters.search"
          icon="i-lucide-search"
          aria-label="Domain or DNS search"
          placeholder="Domain or text"
          class="touch-control min-w-0 flex-1 lg:min-w-48 xl:max-w-60"
          @keydown.enter="logAnalysis && queryState?.canRun && status !== 'loading' && emit('run')"
        />
      </template>
      <template #filters>
        <div
          class="dns-filter-grid grid min-w-0 flex-1 basis-full grid-cols-1 gap-2 lg:min-w-[50.5rem] lg:basis-0 lg:grid-cols-[repeat(6,minmax(8rem,1fr))]"
          data-testid="dns-filter-grid"
        >
          <UFormField :label="isMobile ? 'Query type' : undefined">
            <USelectMenu
              v-model="queryTypeFilter"
              :items="filterOptions.queryTypes"
              aria-label="Query type"
              clear
              :placeholder="isMobile ? 'Any type' : 'Query type'"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="isMobile ? 'Client' : undefined">
            <UInput
              v-model="filters.client"
              aria-label="DNS client"
              :placeholder="isMobile ? 'e.g. 10.0.0.4' : 'Client'"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="isMobile ? 'Protocol' : undefined">
            <USelectMenu
              v-model="protocolFilter"
              :items="filterOptions.protocols"
              aria-label="DNS protocol"
              clear
              :placeholder="isMobile ? 'Any protocol' : 'Protocol'"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="isMobile ? 'Result' : undefined">
            <USelectMenu
              v-model="outcomeFilter"
              :items="outcomeItems"
              value-key="value"
              aria-label="DNS result"
              clear
              :placeholder="isMobile ? 'Any result' : 'Result'"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="isMobile ? 'Source' : undefined">
            <USelectMenu
              v-model="sourceFilter"
              :items="filterOptions.sources"
              aria-label="DNS source"
              clear
              :placeholder="isMobile ? 'Any source' : 'Source'"
              class="w-full"
            />
          </UFormField>
          <UFormField :label="isMobile ? 'Sort order' : undefined">
            <USelect
              v-model="sortSelection"
              :items="sortItems"
              aria-label="DNS sort order"
              class="w-full"
            />
          </UFormField>
        </div>
      </template>
      <template #summary>
        <div class="flex w-full flex-wrap items-center justify-between gap-3">
          <div class="col-span-full flex min-h-11 shrink-0 items-center px-1 lg:min-h-8">
            <UCheckbox
              v-model="showUnidentifiedTransports"
              label="Show unidentified DNS transport"
            />
          </div>
          <LogsLogFilterActions
            :show-apply="logAnalysis && !isMobile"
            :apply-disabled="!canApplyFilters"
            :apply-loading="status === 'loading'"
            @apply="emit('apply')"
            @reset="emit('reset')"
          />
        </div>
      </template>
      <template v-if="$slots['query-controls']" #query="{ mobile }">
        <slot name="query-controls" :mobile="mobile" />
      </template>
    </LogsLogAnalysisToolbar>

    <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden lg:overflow-y-auto lg:p-4">
      <p
        v-if="error"
        role="alert"
        class="mx-4 mt-3 shrink-0 rounded-md bg-red-50 p-3 text-sm text-red-800 lg:m-0 dark:bg-red-950 dark:text-red-100"
      >
        {{ error }}
      </p>
      <div
        v-if="sourceWarnings.length"
        role="status"
        class="mx-4 mt-3 shrink-0 rounded-md bg-amber-50 p-3 text-sm text-amber-900 lg:m-0 dark:bg-amber-950 dark:text-amber-100"
      >
        <p class="font-medium">Some DNS sources could not be queried.</p>
        <ul class="mt-1 list-disc pl-5">
          <li v-for="warning in sourceWarnings" :key="warning.key">{{ warning.text }}</li>
        </ul>
      </div>

      <section
        class="flex min-h-0 flex-1 flex-col overflow-hidden lg:min-h-52 lg:rounded-md lg:border lg:border-brand-gray-200 dark:lg:border-brand-gray-700"
        aria-labelledby="dns-entry-heading"
      >
        <h2
          id="dns-entry-heading"
          class="sr-only lg:not-sr-only lg:flex lg:shrink-0 lg:items-center lg:justify-between lg:border-b lg:border-brand-gray-200 lg:px-3 lg:py-2 lg:text-sm lg:font-semibold dark:lg:border-brand-gray-700"
        >
          <span class="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span>DNS activity</span>
            <span class="text-xs font-normal text-brand-gray-600 dark:text-brand-gray-300">
              Times shown in {{ timeZone }}
            </span>
          </span>
          <span class="flex items-center gap-2">
            <UBadge v-if="entriesTruncated" color="warning" variant="subtle">
              Entries truncated
            </UBadge>
            <UBadge v-if="transportsTruncated" color="warning" variant="subtle">
              Unidentified transport truncated
            </UBadge>
          </span>
        </h2>
        <p
          v-if="isMobile && (entriesTruncated || transportsTruncated)"
          role="status"
          class="px-4 pt-3 text-xs text-amber-800 dark:text-amber-300"
        >
          Result limit reached. Narrow filters or time range for complete results.
        </p>
        <div
          ref="entryViewport"
          class="flex min-h-0 flex-1 flex-col overflow-x-auto px-4 pt-3 lg:p-0"
          data-testid="dns-entry-scroll"
        >
          <div
            v-if="!isMobile && entries.length > 0"
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
              :item-size="isMobile ? 168 : 44"
              :grid-items="isMobile ? mobileColumns : undefined"
              :item-secondary-size="
                isMobile && entryWidth > 0 ? entryWidth / mobileColumns : undefined
              "
              key-field="id"
              class="min-h-0 flex-1"
              :class="isMobile ? 'mobile-results' : 'min-w-394'"
              role="region"
              aria-label="DNS entries"
            >
              <template #default="{ item, index, active }">
                <button
                  v-if="active"
                  type="button"
                  class="border-default px-3 text-left text-xs hover:bg-elevated focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
                  :class="
                    isMobile
                      ? [
                          'flex h-40 flex-col items-stretch justify-start gap-1 rounded-lg border bg-default py-3',
                          tablet ? ['w-[calc(100%-0.25rem)]', index % 2 === 1 && 'ml-1'] : 'w-full',
                        ]
                      : ['grid h-11 w-full items-center gap-2 border-b', dnsEntryGridClass]
                  "
                  :aria-label="
                    item.source !== 'network-rule'
                      ? `Open DNS details for ${item.displayText || item.queryName || item.source}`
                      : `Open DNS transport details for ${item.client || 'unknown client'}`
                  "
                  :aria-pressed="selectedEntryId === item.id"
                  :data-dns-entry="item.id"
                  @click="selectEntry(item)"
                >
                  <template v-if="isMobile">
                    <span class="flex items-center justify-between gap-2 text-muted"
                      ><NuxtTime
                        :datetime="item.timestamp"
                        month="short"
                        day="2-digit"
                        hour="2-digit"
                        minute="2-digit"
                        second="2-digit"
                        :hour-cycle="hourCycle"
                        :time-zone="timeZone"
                      /><span class="font-medium" :class="outcomeClass(item.outcome)">{{
                        outcomeLabel(item.outcome)
                      }}</span></span
                    >
                    <span
                      class="line-clamp-3 font-mono text-sm leading-[18px] font-medium wrap-anywhere"
                      >{{ item.displayText ?? item.queryName ?? "Not observed" }}</span
                    >
                    <span class="flex min-w-0 items-center gap-2 text-muted"
                      ><span class="shrink-0">Client</span
                      ><span class="truncate font-mono text-default">{{
                        item.client || "Not observed"
                      }}</span></span
                    >
                    <span class="flex min-w-0 items-center gap-2 text-muted"
                      ><span class="shrink-0">To</span
                      ><span class="truncate font-mono text-default">{{
                        destination(item)
                      }}</span></span
                    >
                    <span class="mt-auto flex items-center justify-between text-muted"
                      ><span
                        >{{ item.queryType ?? "-" }} · {{ item.protocol ?? "-" }} ·
                        {{ duration(item.durationSeconds) }}</span
                      ><UIcon name="i-lucide-chevron-right" class="size-4"
                    /></span>
                  </template>
                  <template v-else>
                    <NuxtTime
                      :datetime="item.timestamp"
                      hour="2-digit"
                      minute="2-digit"
                      second="2-digit"
                      :hour-cycle="hourCycle"
                      :time-zone="timeZone"
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
                    <span :class="outcomeClass(item.outcome)">{{
                      outcomeLabel(item.outcome)
                    }}</span>
                    <span>{{ duration(item.durationSeconds) }}</span>
                    <span>{{ completeness(item.completeness) }}</span>
                    <span>{{ item.observationCount }}</span>
                  </template>
                </button>
              </template>
            </RecycleScroller>
            <div
              v-else
              class="grid min-h-40 flex-1 place-items-center px-6 py-8 text-center text-sm text-muted"
            >
              <div class="max-w-sm space-y-3">
                <UIcon name="i-lucide-network" class="size-7 text-muted" />
                <h3 class="text-base font-semibold text-default">No DNS activity</h3>
                <p>{{ emptyEntryMessage }}</p>
                <UButton
                  v-if="
                    (activeFilterCount || filters.search) && (!logAnalysis || queryState?.hasRun)
                  "
                  label="Reset filters"
                  variant="outline"
                  color="neutral"
                  class="touch-control"
                  @click="emit('reset')"
                />
                <UButton
                  v-else-if="logAnalysis && !error && status !== 'loading'"
                  :label="
                    !queryState?.canRun
                      ? 'Open Log Analytics settings'
                      : queryState.hasRun
                        ? 'Change time range'
                        : 'Choose time range'
                  "
                  :icon="queryState?.canRun ? 'i-lucide-calendar-range' : 'i-lucide-settings'"
                  class="touch-control"
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
