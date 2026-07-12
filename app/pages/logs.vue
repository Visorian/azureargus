<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";

import visorianNegative from "~/assets/img/visorian-negative.svg";
import visorianPositive from "~/assets/img/visorian-positive.svg";
import type { EventHubConnectionForm } from "~/composables/useEventHubConnection";
import type { AnalysisMode } from "~/composables/useAnalysisMode";
import {
  createDefaultLogFilters,
  isLogFilterValueActive,
  toggleLogFilterValue,
} from "~/composables/useLogQuery";
import { createDefaultLogSort } from "~/composables/useLogSorting";
import { LOG_ANALYSIS_CATEGORIES, type LogAnalysisDateRange } from "~/utils/logAnalysis";
import type { FirewallLogRecord, FirewallLogSortKey } from "~/types/firewall";

definePageMeta({
  layout: "application",
});

interface LogTableColumn {
  key: FirewallLogSortKey;
  label: string;
}

interface DetailField {
  label: string;
  value?: string;
  mono?: boolean;
  wide?: boolean;
}

type QuickFilterKey = "category" | "action" | "protocol" | "source" | "destination";

const logTableColumns: LogTableColumn[] = [
  { key: "timestamp", label: "Date (UTC)" },
  { key: "category", label: "Category" },
  { key: "action", label: "Action" },
  { key: "protocol", label: "Protocol" },
  { key: "sourceIp", label: "Source" },
  { key: "sourcePort", label: "Src port" },
  { key: "destinationIp", label: "Destination" },
  { key: "destinationPort", label: "Dst port" },
  { key: "rule", label: "Rule" },
];
const logTableGridClass =
  "grid-cols-[12rem_13rem_8rem_8rem_9rem_5.5rem_11rem_5.5rem_minmax(16rem,1fr)]";
const quickFilterButtonClass =
  "inline-flex size-6 shrink-0 items-center justify-center rounded text-brand-gray-500 hover:bg-brand-gray-200 hover:text-brand-gray-900 focus-visible:outline-2 focus-visible:outline-brand-blue-500 dark:text-brand-gray-400 dark:hover:bg-brand-gray-800 dark:hover:text-brand-gray-100";

const runtimeConfig = useRuntimeConfig();
const appConfig = useAppConfig();
const versionNumber = appConfig.versionNumber as string;
const receiver = useEventHubReceiver();
const connectionForm = reactive<EventHubConnectionForm>(
  createInitialEventHubConnectionForm(runtimeConfig.public.defaultLookbackMinutes),
);
const { enabled: rememberConnectionString, lastError: connectionStringPersistenceError } =
  useEventHubConnectionPersistence(toRef(connectionForm, "connectionString"));
const connecting = ref(false);
const sidebarCollapsed = ref(false);
const detailOpen = ref(false);
const selectedLog = ref<FirewallLogRecord | null>(null);
const toast = useToast();
const anonymousMode = useAnonymousMode();
const { loggedIn } = useOidcAuth();
const logHistory = useLogHistoryPersistence();
const ipCountryLookup = useIpCountryLookup();
const clearingLogHistory = ref(false);
const logHistoryEnabled = computed(() => logHistory.enabled.value);
const logHistoryError = computed(() => logHistory.lastError.value);
const analysisMode = ref<AnalysisMode>("real-time-analysis");
const logAnalysisActive = computed(() => analysisMode.value === "log-analysis");
const canUseLogAnalysis = computed(() => loggedIn.value && !anonymousMode.enabled.value);
const realTimeQuery = useLogQuery(receiver.logs, {
  rawSource: {
    getRecords: receiver.getRawLogs,
    version: receiver.snapshotVersion,
  },
  visibleLimit: receiver.visibleLimit,
});
const realTimeSorting = useLogSorting(realTimeQuery.filteredLogs);
const logFilters = reactive(createDefaultLogFilters());
const logSort = reactive(createDefaultLogSort());
const logQuery = useLogAnalyticsQuery({
  active: logAnalysisActive,
  filters: logFilters,
  onBeforeReplace: closeDetail,
  onError: (message) => {
    toast.add({
      title: message,
      color: "error",
      icon: "i-lucide-circle-alert",
    });
  },
  sort: logSort,
});
const {
  canApplyFilters: logCanApplyFilters,
  draftRange: logDraftRange,
  hasRun: logHasRun,
  appliedRange: logAppliedRange,
  rangeDirty: logRangeDirty,
  rangeError: logRangeError,
  refinementPending: logRefinementPending,
  status: logQueryStatus,
  truncated: logResultsTruncated,
} = logQuery;
const logResultQuery = useLogQuery(logQuery.records, {
  datasetKey: logQuery.datasetVersion,
  filters: logFilters,
  visibleLimit: logQuery.visibleLimit,
});
const logResultSorting = useLogSorting(logResultQuery.filteredLogs, false, logSort);
const modeState = useAnalysisMode({
  abortLogAnalysis: logQuery.abort,
  canUseLogAnalysis,
  closeDetail,
  disconnectRealTime: receiver.disconnect,
  mode: analysisMode,
});
const modeTransitioning = modeState.transitioning;
const actionLabels: Record<string, string> = {
  allow: "Allow",
  deny: "Deny",
  dnat: "DNAT",
  snat: "SNAT",
};

const realTimeActions = computed(() => {
  return createCaseInsensitiveFilterOptions(
    receiver.actionOptions.value,
    (value) => actionLabels[value.toLowerCase()] ?? value,
  );
});
const realTimeProtocols = computed(() => {
  return createCaseInsensitiveFilterOptions(receiver.protocolOptions.value, (value) =>
    value.toUpperCase(),
  );
});
const activeFilters = computed(() =>
  logAnalysisActive.value ? logResultQuery.filters : realTimeQuery.filters,
);
function createClearableFilterModel(key: "category" | "action" | "protocol") {
  return computed<string | null>({
    get: () => activeFilters.value[key] || null,
    set: (value) => {
      activeFilters.value[key] = value ?? "";
    },
  });
}
const categoryFilter = createClearableFilterModel("category");
const actionFilter = createClearableFilterModel("action");
const protocolFilter = createClearableFilterModel("protocol");
const sortedLogs = computed(() =>
  logAnalysisActive.value ? logResultSorting.sortedLogs.value : realTimeSorting.sortedLogs.value,
);
const categories = computed(() =>
  logAnalysisActive.value ? [...LOG_ANALYSIS_CATEGORIES] : receiver.categoryOptions.value,
);
const actions = computed(() =>
  logAnalysisActive.value ? logQuery.actionOptions.value : realTimeActions.value,
);
const protocols = computed(() =>
  logAnalysisActive.value ? logQuery.protocolOptions.value : realTimeProtocols.value,
);
const activeStatus = computed(() =>
  logAnalysisActive.value ? logQuery.status.value : receiver.status.value,
);
const showRealTimeLag = computed(
  () =>
    !logAnalysisActive.value &&
    (receiver.status.value === "connected" || receiver.status.value === "paused") &&
    receiver.latestSourceTimestamp.value !== null,
);
const countLabel = computed(() => {
  if (!logAnalysisActive.value) {
    return `${sortedLogs.value.length} visible / ${receiver.receivedCount.value} received`;
  }

  const updating = logQuery.status.value === "refreshing" || logQuery.refinementPending.value;
  const suffix = logQuery.truncated.value
    ? ` / first ${logQuery.limit.value?.toLocaleString() ?? ""}`
    : "";
  return `${sortedLogs.value.length} visible${suffix}${updating ? " / updating" : ""}`;
});
const logAppliedRangeLabel = computed(() => {
  if (logAppliedRange.value === null) {
    return "";
  }

  return `${formatTime(logAppliedRange.value.from)} to ${formatTime(logAppliedRange.value.to)}`;
});
const parsedDetailFields = computed<DetailField[]>(() => {
  const log = selectedLog.value;
  if (log === null) {
    return [];
  }

  const fields: DetailField[] = [
    { label: "Timestamp", value: formatTime(log.timestamp), mono: true },
    { label: "Category", value: log.category },
    { label: "Action", value: log.action },
    { label: "Protocol", value: log.protocol },
    { label: "Rule collection", value: log.ruleCollection },
    { label: "Rule", value: log.rule },
    { label: "Source IP", value: log.sourceIp, mono: true },
    { label: "Source port", value: log.sourcePort, mono: true },
    { label: "Destination IP", value: log.destinationIp, mono: true },
    { label: "Destination port", value: log.destinationPort, mono: true },
  ];

  if (!logAnalysisActive.value) {
    fields.push(
      { label: "Partition", value: log.partitionId, mono: true },
      { label: "Sequence", value: log.sequenceNumber, mono: true },
      {
        label: "Enqueued",
        value: log.enqueuedTimeUtc ? formatTime(log.enqueuedTimeUtc) : undefined,
        mono: true,
      },
    );
  }

  return fields;
});
const rawLogJson = computed(() => {
  if (selectedLog.value === null) {
    return "";
  }

  return JSON.stringify(selectedLog.value.raw, null, 2);
});
const rawLogRows = computed(() => Math.min(Math.max(rawLogJson.value.split("\n").length, 6), 24));
const emptyState = computed(() => {
  if (!logAnalysisActive.value) {
    return receiver.logs.value.length > 0
      ? {
          title: "No matching logs",
          description: "Adjust or reset the active filters.",
        }
      : {
          title: "No logs received",
          description: "Connect to an Event Hub with a Listen-only SAS connection string.",
        };
  }

  if (!logQuery.hasRun.value) {
    return {
      title: "No query run",
      description: "Choose an absolute time range and run Log Analytics query.",
    };
  }
  if (logQuery.status.value === "refreshing" || logQuery.refinementPending.value) {
    return {
      title: "Updating results",
      description: "Current filters are being applied in Log Analytics.",
    };
  }
  if (logQuery.records.value.length > 0) {
    return {
      title: "No matching logs",
      description: "No records match active filters.",
    };
  }

  return {
    title: "No logs in range",
    description: "No Azure Firewall records were returned for applied time range.",
  };
});

watch(receiver.errors, (errors) => {
  if (errors.length === 0) {
    return;
  }

  const [title, ...details] = errors;
  toast.add({
    title,
    description: details.length > 0 ? details.join("\n") : undefined,
    color: "error",
    icon: "i-lucide-circle-alert",
  });
});

watch(modeState.lastError, (error) => {
  if (error) {
    toast.add({ title: error, color: "error", icon: "i-lucide-circle-alert" });
  }
});

async function connect() {
  if (modeTransitioning.value || logAnalysisActive.value) {
    return;
  }

  connecting.value = true;
  try {
    await receiver.connect(connectionForm);
  } finally {
    connecting.value = false;
  }
}

function updateConnectionForm(value: EventHubConnectionForm) {
  Object.assign(connectionForm, value);
}

function updateLogDraftRange(value: LogAnalysisDateRange) {
  Object.assign(logDraftRange, value);
}

async function updateLogRetention(enabled: boolean) {
  if (enabled) {
    logHistory.enable();
    return;
  }

  clearingLogHistory.value = true;
  try {
    await logHistory.disableAndClearHistory();
  } finally {
    clearingLogHistory.value = false;
  }
}

async function updateAnalysisMode(mode: AnalysisMode, event: MouseEvent) {
  const control = event.currentTarget;
  await modeState.setMode(mode);
  await nextTick();
  if (control instanceof HTMLElement && control.isConnected) {
    control.focus();
  }
}

function closeDetail() {
  detailOpen.value = false;
  selectedLog.value = null;
}

function resetActiveFilters() {
  if (logAnalysisActive.value) {
    logResultQuery.resetFilters();
    return;
  }
  realTimeQuery.resetFilters();
}

function setSort(key: FirewallLogSortKey) {
  if (logAnalysisActive.value) {
    logResultSorting.setSort(key);
    return;
  }
  realTimeSorting.setSort(key);
}

function getSortIcon(key: FirewallLogSortKey) {
  return logAnalysisActive.value
    ? logResultSorting.getSortIcon(key)
    : realTimeSorting.getSortIcon(key);
}

function getAriaSort(key: FirewallLogSortKey) {
  return logAnalysisActive.value
    ? logResultSorting.getAriaSort(key)
    : realTimeSorting.getAriaSort(key);
}

function createAction(value: string) {
  logQuery.addActionOption(value);
  activeFilters.value.action = value;
}

function createProtocol(value: string) {
  logQuery.addProtocolOption(value);
  activeFilters.value.protocol = value;
}

function isQuickFilterActive(key: QuickFilterKey, value: string | undefined) {
  return isLogFilterValueActive(activeFilters.value[key], value);
}

function toggleQuickFilter(key: QuickFilterKey, value: string | undefined) {
  activeFilters.value[key] = toggleLogFilterValue(activeFilters.value[key], value);
}

function quickFilterLabel(key: QuickFilterKey, value: string | undefined) {
  const action = isQuickFilterActive(key, value) ? "Remove" : "Filter by";
  return `${action} ${key}: ${displayValue(value)}`;
}

function clearActiveResults() {
  if (logAnalysisActive.value) {
    logQuery.clear();
    return;
  }
  receiver.clear();
}

async function runLogAnalysis() {
  await logQuery.run();
}

function applyLogFilters() {
  logQuery.scheduleRefinement(true);
}

function displayValue(value: string | undefined) {
  return value && value.length > 0 ? value : "-";
}

function copyValue(label: string, value: string | undefined) {
  if (!value || value.length === 0) {
    return;
  }

  void navigator.clipboard.writeText(value).then(
    () => {
      toast.add({
        title: `${label} copied`,
        color: "success",
        icon: "i-lucide-copy-check",
      });
    },
    () => {
      toast.add({
        title: `Could not copy ${label.toLowerCase()}`,
        color: "error",
        icon: "i-lucide-circle-alert",
      });
    },
  );
}

function selectLog(log: FirewallLogRecord) {
  selectedLog.value = { ...log };
  detailOpen.value = true;
}

function clearClosedDetail() {
  if (!detailOpen.value) {
    selectedLog.value = null;
  }
}

function collapseSidebar() {
  sidebarCollapsed.value = true;
}

function expandSidebar() {
  sidebarCollapsed.value = false;
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp;
  }

  return date.toISOString().replace("T", " ").replace(".000Z", "Z");
}

function rowTitle(log: FirewallLogRecord) {
  return [
    formatTime(log.timestamp),
    log.category,
    log.action,
    log.protocol,
    `${displayValue(log.sourceIp)}:${displayValue(log.sourcePort)}`,
    `${displayValue(log.destinationIp)}:${displayValue(log.destinationPort)}`,
    log.rule,
    log.message,
  ]
    .filter(Boolean)
    .join(" | ");
}

function statusColor(status: string) {
  if (status === "connected" || status === "success") {
    return "success";
  }
  if (status === "paused" || status === "refreshing") {
    return "warning";
  }
  if (status === "error") {
    return "error";
  }
  if (status === "loading" || status === "connecting") {
    return "info";
  }
  return "neutral";
}
</script>

<template>
  <div
    class="flex h-full min-h-0 flex-col overflow-hidden bg-white text-brand-gray-950 dark:bg-brand-gray-950 dark:text-brand-gray-50"
  >
    <section
      class="shrink-0 border-b border-brand-gray-300 bg-brand-gray-50 px-4 py-3 dark:border-brand-gray-700 dark:bg-brand-gray-900"
      aria-labelledby="data-source-label"
    >
      <div class="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div class="flex min-w-0 flex-wrap items-center gap-3">
          <span
            id="data-source-label"
            class="text-xs font-semibold tracking-wide text-brand-gray-600 uppercase dark:text-brand-gray-300"
          >
            Data source
          </span>
          <div role="group" aria-labelledby="data-source-label" class="shrink-0">
            <UFieldGroup size="sm">
              <UButton
                icon="i-lucide-radio"
                :variant="logAnalysisActive ? 'outline' : 'solid'"
                :color="logAnalysisActive ? 'neutral' : 'primary'"
                :aria-pressed="!logAnalysisActive"
                :disabled="modeTransitioning"
                :loading="modeTransitioning && logAnalysisActive"
                @click="updateAnalysisMode('real-time-analysis', $event)"
              >
                <span>Live Event Hub</span>
                <span aria-hidden="true" class="inline-grid size-4 place-items-center">
                  <UIcon v-if="!logAnalysisActive" name="i-lucide-check" class="size-3.5" />
                </span>
              </UButton>
              <UButton
                icon="i-lucide-chart-no-axes-combined"
                :variant="logAnalysisActive ? 'solid' : 'outline'"
                :color="logAnalysisActive ? 'primary' : 'neutral'"
                :aria-pressed="logAnalysisActive"
                :aria-describedby="!canUseLogAnalysis ? 'log-analytics-requirement' : undefined"
                :disabled="!canUseLogAnalysis || modeTransitioning"
                :loading="modeTransitioning && !logAnalysisActive"
                @click="updateAnalysisMode('log-analysis', $event)"
              >
                <span>Log Analytics</span>
                <span aria-hidden="true" class="inline-grid size-4 place-items-center">
                  <UIcon v-if="logAnalysisActive" name="i-lucide-check" class="size-3.5" />
                </span>
              </UButton>
            </UFieldGroup>
          </div>
          <p
            v-if="!canUseLogAnalysis"
            id="log-analytics-requirement"
            class="text-xs text-brand-gray-600 dark:text-brand-gray-300"
          >
            Log Analytics requires sign-in.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <UBadge
            :color="statusColor(activeStatus)"
            variant="subtle"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {{ activeStatus }}
          </UBadge>
          <UBadge v-if="showRealTimeLag" icon="i-lucide-clock-3" color="neutral" variant="outline">
            <span>{{ receiver.caughtUp.value ? "Latest" : "Catching up" }}</span>
            <NuxtTime
              :datetime="receiver.latestSourceTimestamp.value!"
              relative
              relative-style="narrow"
              numeric="always"
              :title="true"
            />
          </UBadge>
        </div>
      </div>
    </section>

    <div
      :class="[
        'relative grid min-h-0 flex-1 overflow-hidden',
        sidebarCollapsed
          ? 'grid-cols-1 grid-rows-1'
          : 'grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[1fr_23rem] lg:grid-rows-1',
      ]"
    >
      <UButton
        v-if="sidebarCollapsed"
        icon="i-lucide-panel-right-open"
        aria-label="Expand sidebar"
        color="neutral"
        variant="outline"
        square
        size="sm"
        class="absolute top-1/2 right-2 z-20 -translate-y-1/2 rounded-full bg-white dark:bg-brand-gray-950"
        @click="expandSidebar"
      />

      <aside
        v-show="!sidebarCollapsed"
        class="relative flex max-h-80 min-h-0 flex-col border-b border-brand-gray-300 bg-white dark:border-brand-gray-700 dark:bg-brand-gray-950 lg:order-2 lg:max-h-none lg:border-b-0 lg:border-l"
      >
        <UButton
          icon="i-lucide-panel-right-close"
          aria-label="Collapse sidebar"
          color="neutral"
          variant="outline"
          square
          size="sm"
          class="absolute top-3 right-3 z-20 rounded-full bg-white dark:bg-brand-gray-950 lg:top-1/2 lg:right-auto lg:left-0 lg:-translate-x-1/2 lg:-translate-y-1/2"
          @click="collapseSidebar"
        />

        <section class="min-h-0 flex-1 overflow-y-auto p-4">
          <LogsEventHubSettingsPanel
            v-if="!logAnalysisActive"
            v-model:remember-connection-string="rememberConnectionString"
            :connection-form="connectionForm"
            :clearing-log-history="clearingLogHistory"
            :connecting="connecting"
            :connection-string-persistence-error="connectionStringPersistenceError"
            :log-history-enabled="logHistoryEnabled"
            :log-history-error="logHistoryError"
            :mode-transitioning="modeTransitioning"
            @update:connection-form="updateConnectionForm"
            @connect="connect"
            @disconnect="receiver.disconnect"
            @update-log-retention="updateLogRetention"
          />
          <LogsLogAnalyticsSettingsPanel
            v-else
            :draft-range="logDraftRange"
            :applied-range-label="logAppliedRangeLabel"
            :query-status="logQueryStatus"
            :range-dirty="logRangeDirty"
            :range-error="logRangeError"
            :results-truncated="logResultsTruncated"
            @update:draft-range="updateLogDraftRange"
            @run="runLogAnalysis"
          />
        </section>

        <footer
          class="space-y-1 border-t border-brand-gray-200 px-4 py-3 text-xs font-mono text-brand-gray-500 dark:border-brand-gray-800 dark:text-brand-gray-500"
        >
          <span class="block select-none">
            Version: {{ versionNumber }} by
            <a
              href="https://www.visorian.com"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 underline hover:text-brand-gray-700 dark:hover:text-brand-gray-300"
            >
              <img
                :src="visorianPositive"
                alt=""
                aria-hidden="true"
                class="h-3 w-auto dark:hidden"
              />
              <img
                :src="visorianNegative"
                alt=""
                aria-hidden="true"
                class="hidden h-3 w-auto dark:inline"
              />
              Visorian
            </a>
          </span>
          <span class="block select-none">
            IP geolocation by
            <a
              href="https://db-ip.com"
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-brand-gray-700 dark:hover:text-brand-gray-300"
            >
              DB-IP
            </a>
          </span>
        </footer>
      </aside>

      <section
        class="flex min-h-0 flex-col overflow-hidden bg-brand-gray-50 dark:bg-brand-gray-950 lg:order-1"
      >
        <div
          class="shrink-0 border-b border-brand-gray-300 bg-white p-4 dark:border-brand-gray-700 dark:bg-brand-gray-950"
        >
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-sm text-brand-gray-600 dark:text-brand-gray-300">
                {{ countLabel }}
              </span>
            </div>
            <div class="flex gap-2">
              <UButton
                v-if="!logAnalysisActive && receiver.status.value === 'connected'"
                variant="outline"
                color="neutral"
                icon="i-lucide-pause"
                label="Pause"
                @click="receiver.pause"
              />
              <UButton
                v-if="!logAnalysisActive && receiver.status.value === 'paused'"
                variant="outline"
                color="neutral"
                icon="i-lucide-play"
                label="Resume"
                @click="receiver.resume"
              />
              <UButton
                variant="outline"
                color="neutral"
                icon="i-lucide-trash-2"
                :label="logAnalysisActive ? 'Clear results' : 'Clear'"
                @click="clearActiveResults"
              />
            </div>
          </div>

          <div class="mt-3 flex flex-wrap gap-2">
            <UInput
              v-model="activeFilters.search"
              icon="i-lucide-search"
              placeholder="Search logs"
              class="min-w-48 flex-1"
              @keydown.enter="logAnalysisActive && applyLogFilters()"
            />
            <USelectMenu
              v-model="categoryFilter"
              :items="categories"
              clear
              placeholder="Category"
              class="w-38"
            />
            <USelectMenu
              v-model="actionFilter"
              :items="actions"
              :create-item="logAnalysisActive"
              clear
              placeholder="Action"
              class="w-34"
              @create="createAction"
            />
            <USelectMenu
              v-model="protocolFilter"
              :items="protocols"
              :create-item="logAnalysisActive"
              clear
              placeholder="Protocol"
              class="w-34"
              @create="createProtocol"
            />
            <UInput
              v-model="activeFilters.source"
              placeholder="Source"
              class="w-40"
              @keydown.enter="logAnalysisActive && applyLogFilters()"
            />
            <UInput
              v-model="activeFilters.destination"
              placeholder="Destination"
              class="w-40"
              @keydown.enter="logAnalysisActive && applyLogFilters()"
            />
            <UButton
              v-if="logAnalysisActive"
              variant="outline"
              color="neutral"
              icon="i-lucide-filter"
              label="Apply filters"
              :disabled="!logCanApplyFilters || logRangeDirty"
              :loading="logQueryStatus === 'refreshing'"
              @click="applyLogFilters"
            />
            <UButton
              variant="ghost"
              color="neutral"
              icon="i-lucide-rotate-ccw"
              label="Reset"
              @click="resetActiveFilters"
            />
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden bg-white dark:bg-brand-gray-950">
          <div
            role="table"
            aria-label="Firewall logs"
            class="flex h-full min-h-0 flex-col overflow-hidden"
          >
            <div
              role="row"
              :class="[
                'grid h-11 shrink-0 border-b border-brand-gray-300 bg-brand-gray-100 text-xs font-semibold text-brand-gray-800 dark:border-brand-gray-700 dark:bg-brand-gray-900 dark:text-brand-gray-100',
                logTableGridClass,
              ]"
            >
              <button
                v-for="column in logTableColumns"
                :key="column.key"
                type="button"
                role="columnheader"
                :aria-sort="getAriaSort(column.key)"
                class="flex min-w-0 items-center gap-1 px-2 text-left"
                @click="setSort(column.key)"
              >
                <span class="truncate">{{ column.label }}</span>
                <UIcon
                  :name="getSortIcon(column.key)"
                  class="size-3 shrink-0 text-brand-gray-500"
                />
              </button>
            </div>

            <ClientOnly>
              <RecycleScroller
                v-if="sortedLogs.length > 0"
                v-slot="{ item }"
                :items="sortedLogs"
                :item-size="64"
                :emit-update="false"
                key-field="id"
                class="min-h-0 flex-1"
              >
                <div
                  role="row"
                  tabindex="0"
                  :title="rowTitle(item)"
                  :class="[
                    'grid h-16 w-full items-center border-b border-brand-gray-200 bg-white text-left text-sm text-brand-gray-950 hover:bg-brand-blue-50 focus-visible:outline-2 focus-visible:outline-brand-blue-500 dark:border-brand-gray-700 dark:bg-brand-gray-950 dark:text-brand-gray-50 dark:hover:bg-brand-gray-900',
                    logTableGridClass,
                  ]"
                  @click="selectLog(item)"
                  @keydown.enter.self="selectLog(item)"
                  @keydown.space.self.prevent="selectLog(item)"
                >
                  <span
                    role="cell"
                    class="min-w-0 truncate px-2 font-mono text-xs whitespace-nowrap text-brand-gray-700 dark:text-brand-gray-200"
                    :title="formatTime(item.timestamp)"
                  >
                    <NuxtTime
                      :datetime="item.timestamp"
                      date-style="medium"
                      time-style="medium"
                      time-zone="UTC"
                      hour-cycle="h23"
                    />
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                    <span class="truncate">{{ displayValue(item.category) }}</span>
                    <button
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('category', item.category) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('category', item.category)"
                      :aria-pressed="isQuickFilterActive('category', item.category)"
                      :title="quickFilterLabel('category', item.category)"
                      @click.stop="toggleQuickFilter('category', item.category)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2 font-medium">
                    <span class="truncate">{{ displayValue(item.action) }}</span>
                    <button
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('action', item.action) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('action', item.action)"
                      :aria-pressed="isQuickFilterActive('action', item.action)"
                      :title="quickFilterLabel('action', item.action)"
                      @click.stop="toggleQuickFilter('action', item.action)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                    <span class="truncate">{{ displayValue(item.protocol) }}</span>
                    <button
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('protocol', item.protocol) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('protocol', item.protocol)"
                      :aria-pressed="isQuickFilterActive('protocol', item.protocol)"
                      :title="quickFilterLabel('protocol', item.protocol)"
                      @click.stop="toggleQuickFilter('protocol', item.protocol)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                    <span class="truncate">{{ displayValue(item.sourceIp) }}</span>
                    <button
                      v-if="item.sourceIp"
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('source', item.sourceIp) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('source', item.sourceIp)"
                      :aria-pressed="isQuickFilterActive('source', item.sourceIp)"
                      :title="quickFilterLabel('source', item.sourceIp)"
                      @click.stop="toggleQuickFilter('source', item.sourceIp)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2 font-mono text-xs">
                    <span class="truncate">{{ displayValue(item.sourcePort) }}</span>
                    <button
                      v-if="item.sourcePort"
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('source', item.sourcePort) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('source', item.sourcePort)"
                      :aria-pressed="isQuickFilterActive('source', item.sourcePort)"
                      :title="quickFilterLabel('source', item.sourcePort)"
                      @click.stop="toggleQuickFilter('source', item.sourcePort)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                    <DestinationCountryFlag
                      :destination="item.destinationIp"
                      :lookup="ipCountryLookup"
                    />
                    <span class="truncate">{{ displayValue(item.destinationIp) }}</span>
                    <button
                      v-if="item.destinationIp"
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('destination', item.destinationIp) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('destination', item.destinationIp)"
                      :aria-pressed="isQuickFilterActive('destination', item.destinationIp)"
                      :title="quickFilterLabel('destination', item.destinationIp)"
                      @click.stop="toggleQuickFilter('destination', item.destinationIp)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="flex min-w-0 items-center gap-1 px-2 font-mono text-xs">
                    <span class="truncate">{{ displayValue(item.destinationPort) }}</span>
                    <button
                      v-if="item.destinationPort"
                      type="button"
                      :class="[
                        quickFilterButtonClass,
                        isQuickFilterActive('destination', item.destinationPort) &&
                          'bg-brand-blue-100 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300',
                      ]"
                      :aria-label="quickFilterLabel('destination', item.destinationPort)"
                      :aria-pressed="isQuickFilterActive('destination', item.destinationPort)"
                      :title="quickFilterLabel('destination', item.destinationPort)"
                      @click.stop="toggleQuickFilter('destination', item.destinationPort)"
                    >
                      <UIcon name="i-lucide-filter" class="size-3.5" />
                    </button>
                  </span>
                  <span role="cell" class="truncate px-2">{{ displayValue(item.rule) }}</span>
                </div>
              </RecycleScroller>
              <div v-else class="grid min-h-0 flex-1 place-items-center p-8 text-center">
                <div class="max-w-sm space-y-2">
                  <UIcon name="i-lucide-list-filter" class="mx-auto size-8 text-brand-gray-400" />
                  <h2 class="text-sm font-semibold">{{ emptyState.title }}</h2>
                  <p class="text-sm text-brand-gray-600 dark:text-brand-gray-300">
                    {{ emptyState.description }}
                  </p>
                </div>
              </div>
            </ClientOnly>
          </div>
        </div>
      </section>
    </div>

    <UModal
      v-model:open="detailOpen"
      title="Log detail"
      :ui="{ content: 'select-none', body: 'select-none' }"
      @after:leave="clearClosedDetail"
    >
      <template #body>
        <div v-if="selectedLog" class="space-y-4">
          <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div
              v-for="field in parsedDetailFields"
              :key="field.label"
              :class="field.wide ? 'sm:col-span-2' : ''"
            >
              <dt class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                {{ field.label }}
              </dt>
              <dd
                class="mt-1 flex min-w-0 items-start gap-2 text-brand-gray-950 dark:text-brand-gray-50"
              >
                <span :class="['min-w-0 break-words', field.mono ? 'font-mono text-xs' : '']">
                  {{ displayValue(field.value) }}
                </span>
                <UButton
                  class="shrink-0"
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  icon="i-lucide-copy"
                  :aria-label="`Copy ${field.label}`"
                  :disabled="!field.value"
                  @click.stop="copyValue(field.label, field.value)"
                />
              </dd>
            </div>
          </dl>
          <section
            class="rounded-md border border-brand-gray-200 bg-brand-gray-50 dark:border-brand-gray-700 dark:bg-brand-gray-900"
          >
            <div
              class="flex items-center justify-between border-b border-brand-gray-200 px-3 py-2 dark:border-brand-gray-700"
            >
              <h3 class="text-xs font-semibold text-brand-gray-700 dark:text-brand-gray-200">
                Raw message
              </h3>
              <UButton
                variant="ghost"
                color="neutral"
                size="xs"
                icon="i-lucide-copy"
                label="Copy raw"
                @click="copyValue('Raw message', rawLogJson)"
              />
            </div>
            <textarea
              :value="rawLogJson"
              :rows="rawLogRows"
              aria-label="Raw message"
              readonly
              spellcheck="false"
              wrap="off"
              class="block max-h-96 w-full resize-none overflow-auto border-0 bg-transparent p-3 font-mono text-xs leading-5 select-text text-brand-gray-950 focus:outline-none dark:text-brand-gray-50"
            />
          </section>
        </div>
      </template>
    </UModal>
  </div>
</template>
