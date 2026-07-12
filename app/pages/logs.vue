<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";

import visorianNegative from "~/assets/img/visorian-negative.svg";
import visorianPositive from "~/assets/img/visorian-positive.svg";
import {
  EVENT_HUB_LOOKBACK_OPTIONS,
  type EventHubConnectionForm,
} from "~/composables/useEventHubConnection";
import type { AnalysisMode } from "~/composables/useAnalysisMode";
import {
  createDefaultLogFilters,
  isLogFilterValueActive,
  toggleLogFilterValue,
} from "~/composables/useLogQuery";
import { createDefaultLogSort } from "~/composables/useLogSorting";
import { hasLogAnalysisRole, LOG_ANALYSIS_CATEGORIES } from "~/utils/logAnalysis";
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
  "grid-cols-[7.5rem_13rem_6rem_8rem_9rem_5.5rem_9rem_5.5rem_minmax(16rem,1fr)]";

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
const { loggedIn, user } = useOidcAuth();
const logHistory = useLogHistoryPersistence();
const clearingLogHistory = ref(false);
const logHistoryEnabled = computed(() => logHistory.enabled.value);
const logHistoryError = computed(() => logHistory.lastError.value);
const analysisMode = ref<AnalysisMode>("real-time-analysis");
const logAnalysisActive = computed(() => analysisMode.value === "log-analysis");
const canUseLogAnalysis = computed(
  () => loggedIn.value && !anonymousMode.enabled.value && hasLogAnalysisRole(user.value),
);
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

async function updateAnalysisMode(mode: AnalysisMode) {
  await modeState.setMode(mode);
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
    :class="[
      'relative grid h-full min-h-0 overflow-hidden bg-white text-brand-gray-950 dark:bg-brand-gray-950 dark:text-brand-gray-50',
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
      size="xs"
      class="absolute top-1/2 right-0 z-20 -translate-y-1/2 rounded-r-none border-r-0 bg-white dark:bg-brand-gray-950"
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
        size="xs"
        class="absolute top-3 right-3 z-20 rounded-full bg-white dark:bg-brand-gray-950 lg:top-1/2 lg:right-auto lg:left-0 lg:-translate-x-1/2 lg:-translate-y-1/2"
        @click="collapseSidebar"
      />

      <section class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <template v-if="!logAnalysisActive">
          <div>
            <h2 class="text-sm font-semibold">Event Hub connection</h2>
            <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
              Use a Listen-only SAS policy. Credentials stay in memory unless remembered.
            </p>
          </div>

          <UForm :state="connectionForm" class="space-y-3" @submit="connect">
            <UFormField label="Connection string" name="connectionString" required>
              <UTextarea
                v-model="connectionForm.connectionString"
                :rows="4"
                class="w-full"
                placeholder="Endpoint=sb://...;SharedAccessKeyName=...;SharedAccessKey=...;EntityPath=..."
              />
            </UFormField>
            <UCheckbox
              v-model="rememberConnectionString"
              label="Remember connection string"
              description="Stores this SAS credential unencrypted in browser storage. Avoid shared devices."
            />
            <p
              v-if="connectionStringPersistenceError"
              role="alert"
              class="text-xs text-red-600 dark:text-red-400"
            >
              {{ connectionStringPersistenceError }}
            </p>
            <UFormField label="Consumer group" name="consumerGroup" required>
              <UInput v-model="connectionForm.consumerGroup" class="w-full" />
            </UFormField>
            <UFormField label="Event Hub name" name="eventHubName">
              <UInput
                v-model="connectionForm.eventHubName"
                class="w-full"
                placeholder="Only needed without EntityPath"
              />
            </UFormField>
            <UFormField label="Lookback" name="lookbackMinutes">
              <USelect
                v-model="connectionForm.lookbackMinutes"
                :items="EVENT_HUB_LOOKBACK_OPTIONS"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Visible rows" name="bufferSize">
              <UInput
                v-model.number="connectionForm.bufferSize"
                type="number"
                min="100"
                step="100"
                class="w-full"
              />
            </UFormField>
            <div class="flex gap-2">
              <UButton
                type="submit"
                color="primary"
                variant="solid"
                icon="i-lucide-radio-receiver"
                label="Connect"
                :disabled="modeTransitioning"
                :loading="connecting"
              />
              <UButton
                variant="outline"
                color="neutral"
                icon="i-lucide-unplug"
                label="Disconnect"
                @click="receiver.disconnect"
              />
            </div>
          </UForm>

          <div class="border-t border-brand-gray-200 pt-3 dark:border-brand-gray-800">
            <div class="flex items-center gap-1">
              <USwitch
                label="Local log retention"
                :model-value="logHistoryEnabled"
                :disabled="clearingLogHistory"
                :loading="clearingLogHistory"
                @update:model-value="updateLogRetention"
              />
              <UTooltip :content="{ side: 'bottom' }" :ui="{ content: 'h-auto max-w-72 p-3' }">
                <UButton
                  icon="i-lucide-info"
                  aria-label="About local log retention"
                  color="neutral"
                  variant="ghost"
                  size="xs"
                  square
                />
                <template #content>
                  <p class="text-xs leading-5 whitespace-normal">
                    Keeps up to 100,000 parsed Real-time records in this browser for up to 24 hours.
                    Raw payloads are excluded. Turning retention off or starting a new session
                    clears saved records.
                  </p>
                </template>
              </UTooltip>
            </div>
            <p
              v-if="logHistoryError"
              role="alert"
              class="mt-2 text-xs text-red-600 dark:text-red-400"
            >
              {{ logHistoryError }}
            </p>
          </div>
        </template>

        <template v-else>
          <div>
            <h2 class="text-sm font-semibold">Log Analytics query</h2>
            <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
              Query configured Azure Firewall workspace.
            </p>
          </div>

          <UForm :state="logDraftRange" class="space-y-3" @submit="runLogAnalysis">
            <UFormField label="Start" name="from" required>
              <UInput v-model="logDraftRange.from" type="datetime-local" class="w-full" />
            </UFormField>
            <UFormField label="End" name="to" required>
              <UInput v-model="logDraftRange.to" type="datetime-local" class="w-full" />
            </UFormField>
            <UButton
              type="submit"
              color="primary"
              variant="solid"
              icon="i-lucide-search"
              label="Run query"
              :loading="logQueryStatus === 'loading'"
            />
          </UForm>

          <p v-if="logRangeError" role="alert" class="text-xs text-red-600 dark:text-red-400">
            {{ logRangeError }}
          </p>
          <p v-else-if="logRangeDirty" class="text-xs text-amber-700 dark:text-amber-300">
            Run query to apply date range. Results still show
            {{ logAppliedRange ? formatTime(logAppliedRange.from) : "" }} to
            {{ logAppliedRange ? formatTime(logAppliedRange.to) : "" }}.
          </p>
          <p
            v-if="logResultsTruncated"
            class="border-t border-brand-gray-200 pt-3 text-xs text-brand-gray-600 dark:border-brand-gray-800 dark:text-brand-gray-300"
          >
            Result limit reached. Narrow filters or time range for complete results.
          </p>
        </template>
      </section>

      <footer
        class="border-t border-brand-gray-200 px-4 py-3 text-xs font-mono text-brand-gray-500 dark:border-brand-gray-800 dark:text-brand-gray-500"
      >
        <span class="select-none">
          Version: {{ versionNumber }} by
          <a
            href="https://www.visorian.com"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 underline hover:text-brand-gray-700 dark:hover:text-brand-gray-300"
          >
            <img :src="visorianPositive" alt="" aria-hidden="true" class="h-3 w-auto dark:hidden" />
            <img
              :src="visorianNegative"
              alt=""
              aria-hidden="true"
              class="hidden h-3 w-auto dark:inline"
            />
            Visorian
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
            <UFieldGroup size="sm">
              <UButton
                icon="i-lucide-radio"
                label="Real-time analysis"
                :variant="logAnalysisActive ? 'outline' : 'solid'"
                :color="logAnalysisActive ? 'neutral' : 'primary'"
                :disabled="modeTransitioning"
                :loading="modeTransitioning && logAnalysisActive"
                @click="updateAnalysisMode('real-time-analysis')"
              />
              <UButton
                icon="i-lucide-chart-no-axes-combined"
                label="Log analysis"
                :variant="logAnalysisActive ? 'solid' : 'outline'"
                :color="logAnalysisActive ? 'primary' : 'neutral'"
                :disabled="!canUseLogAnalysis || modeTransitioning"
                :loading="modeTransitioning && !logAnalysisActive"
                title="Requires an authenticated user with LogAnalysis.Read role"
                @click="updateAnalysisMode('log-analysis')"
              />
            </UFieldGroup>
            <UBadge :color="statusColor(activeStatus)" variant="subtle">
              {{ activeStatus }}
            </UBadge>
            <UBadge
              v-if="showRealTimeLag"
              icon="i-lucide-clock-3"
              color="neutral"
              variant="outline"
            >
              <span>{{ receiver.caughtUp.value ? "Latest" : "Catching up" }}</span>
              <NuxtTime
                :datetime="receiver.latestSourceTimestamp.value!"
                relative
                relative-style="narrow"
                numeric="always"
                :title="true"
              />
            </UBadge>
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
              <UIcon :name="getSortIcon(column.key)" class="size-3 shrink-0 text-brand-gray-500" />
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
                  class="flex min-w-0 flex-col px-2 font-mono text-xs leading-4 text-brand-gray-700 dark:text-brand-gray-200"
                  :title="formatTime(item.timestamp)"
                >
                  <NuxtTime :datetime="item.timestamp" date-style="medium" time-zone="UTC" />
                  <NuxtTime
                    :datetime="item.timestamp"
                    time-style="medium"
                    time-zone="UTC"
                    hour-cycle="h23"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                  <span class="truncate">{{ displayValue(item.category) }}</span>
                  <UButton
                    square
                    size="xs"
                    :variant="isQuickFilterActive('category', item.category) ? 'soft' : 'ghost'"
                    :color="isQuickFilterActive('category', item.category) ? 'primary' : 'neutral'"
                    :icon="
                      isQuickFilterActive('category', item.category)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('category', item.category)"
                    @click.stop="toggleQuickFilter('category', item.category)"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2 font-medium">
                  <span class="truncate">{{ displayValue(item.action) }}</span>
                  <UButton
                    square
                    size="xs"
                    :variant="isQuickFilterActive('action', item.action) ? 'soft' : 'ghost'"
                    :color="isQuickFilterActive('action', item.action) ? 'primary' : 'neutral'"
                    :icon="
                      isQuickFilterActive('action', item.action)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('action', item.action)"
                    @click.stop="toggleQuickFilter('action', item.action)"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                  <span class="truncate">{{ displayValue(item.protocol) }}</span>
                  <UButton
                    square
                    size="xs"
                    :variant="isQuickFilterActive('protocol', item.protocol) ? 'soft' : 'ghost'"
                    :color="isQuickFilterActive('protocol', item.protocol) ? 'primary' : 'neutral'"
                    :icon="
                      isQuickFilterActive('protocol', item.protocol)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('protocol', item.protocol)"
                    @click.stop="toggleQuickFilter('protocol', item.protocol)"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                  <span class="truncate">{{ displayValue(item.sourceIp) }}</span>
                  <UButton
                    v-if="item.sourceIp"
                    square
                    size="xs"
                    :variant="isQuickFilterActive('source', item.sourceIp) ? 'soft' : 'ghost'"
                    :color="isQuickFilterActive('source', item.sourceIp) ? 'primary' : 'neutral'"
                    :icon="
                      isQuickFilterActive('source', item.sourceIp)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('source', item.sourceIp)"
                    @click.stop="toggleQuickFilter('source', item.sourceIp)"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2 font-mono text-xs">
                  <span class="truncate">{{ displayValue(item.sourcePort) }}</span>
                  <UButton
                    v-if="item.sourcePort"
                    square
                    size="xs"
                    :variant="isQuickFilterActive('source', item.sourcePort) ? 'soft' : 'ghost'"
                    :color="isQuickFilterActive('source', item.sourcePort) ? 'primary' : 'neutral'"
                    :icon="
                      isQuickFilterActive('source', item.sourcePort)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('source', item.sourcePort)"
                    @click.stop="toggleQuickFilter('source', item.sourcePort)"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2">
                  <span class="truncate">{{ displayValue(item.destinationIp) }}</span>
                  <UButton
                    v-if="item.destinationIp"
                    square
                    size="xs"
                    :variant="
                      isQuickFilterActive('destination', item.destinationIp) ? 'soft' : 'ghost'
                    "
                    :color="
                      isQuickFilterActive('destination', item.destinationIp) ? 'primary' : 'neutral'
                    "
                    :icon="
                      isQuickFilterActive('destination', item.destinationIp)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('destination', item.destinationIp)"
                    @click.stop="toggleQuickFilter('destination', item.destinationIp)"
                  />
                </span>
                <span role="cell" class="flex min-w-0 items-center gap-1 px-2 font-mono text-xs">
                  <span class="truncate">{{ displayValue(item.destinationPort) }}</span>
                  <UButton
                    v-if="item.destinationPort"
                    square
                    size="xs"
                    :variant="
                      isQuickFilterActive('destination', item.destinationPort) ? 'soft' : 'ghost'
                    "
                    :color="
                      isQuickFilterActive('destination', item.destinationPort)
                        ? 'primary'
                        : 'neutral'
                    "
                    :icon="
                      isQuickFilterActive('destination', item.destinationPort)
                        ? 'i-lucide-filter-x'
                        : 'i-lucide-filter'
                    "
                    :aria-label="quickFilterLabel('destination', item.destinationPort)"
                    @click.stop="toggleQuickFilter('destination', item.destinationPort)"
                  />
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

    <UModal v-model:open="detailOpen" title="Log detail" @after:leave="clearClosedDetail">
      <template #body>
        <div v-if="selectedLog" class="space-y-4 select-text">
          <dl class="grid grid-cols-1 gap-3 text-sm select-text sm:grid-cols-2">
            <div
              v-for="field in parsedDetailFields"
              :key="field.label"
              :class="field.wide ? 'sm:col-span-2' : ''"
            >
              <dt
                class="flex items-center gap-2 text-xs text-brand-gray-600 dark:text-brand-gray-300"
              >
                <span class="min-w-0">{{ field.label }}</span>
                <UButton
                  variant="ghost"
                  color="neutral"
                  size="xs"
                  icon="i-lucide-copy"
                  :aria-label="`Copy ${field.label}`"
                  :disabled="!field.value"
                  @click.stop="copyValue(field.label, field.value)"
                />
              </dt>
              <dd
                :class="[
                  'mt-1 break-words text-brand-gray-950 dark:text-brand-gray-50',
                  field.mono ? 'font-mono text-xs' : '',
                ]"
              >
                {{ displayValue(field.value) }}
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
            <pre
              class="max-h-96 overflow-auto p-3 text-xs select-text text-brand-gray-950 dark:text-brand-gray-50"
              >{{ rawLogJson }}</pre>
          </section>
        </div>
      </template>
    </UModal>
  </div>
</template>
