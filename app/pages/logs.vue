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
import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
} from "#shared/types/logAnalytics";
import type {
  AzureAccessibleTenant,
  AzureAccessibleWorkspace,
  AzureLogAnalyticsAccess,
} from "#shared/types/azureAccess";
import type {
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsFilters,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsReadinessResponse,
  DnsSort,
} from "#shared/types/dns";
import type { DnsReadinessTarget } from "~/composables/useDnsSourceReadiness";
import { createDefaultLogSort } from "~/composables/useLogSorting";
import { formatIcmpProtocol } from "~/utils/icmpProtocol";
import { createLogAnalyticsAdminConsentUrl, isEntraId } from "~/utils/logAnalyticsOnboarding";
import {
  createDefaultLogAnalysisDateRange,
  LOG_ANALYSIS_CATEGORIES,
  type LogAnalysisDateRange,
} from "~/utils/logAnalysis";
import type { FirewallLogRecord, FirewallLogSortKey } from "~/types/firewall";
import { DEFAULT_LOG_ANALYTICS_QUERY_LIMIT } from "#shared/utils/logAnalytics";

definePageMeta({
  layout: "application",
});

interface LogTableColumn {
  key: FirewallLogSortKey;
  label: string;
}

interface DetailField {
  countryDestination?: string;
  label: string;
  value?: string;
  mono?: boolean;
  wide?: boolean;
}

interface DetailSection {
  fields: DetailField[];
  title?: string;
}

type QuickFilterKey = "category" | "action" | "protocol" | "source" | "destination";
type LogsLens = "all-logs" | "dns-troubleshooting";

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
const deployment = useDeploymentCapabilities();
const capabilities = computed(() => deployment.capabilities.value);
const managedMode = computed(() => capabilities.value?.mode === "managed");
const eventHubSourceAvailable = computed(
  () => capabilities.value?.mode === "anonymous" || capabilities.value?.eventHubAvailable === true,
);
const logAnalyticsSourceAvailable = computed(() =>
  capabilities.value?.mode === "anonymous"
    ? capabilities.value.temporaryLogAnalyticsAuthAvailable
    : capabilities.value?.predefinedLogAnalyticsAvailable === true,
);
const versionNumber = appConfig.versionNumber as string;
const activeLens = ref<LogsLens>("all-logs");
const allLogsLensActive = computed(() => activeLens.value === "all-logs");
const receiver = useEventHubReceiver({ uiPublishingEnabled: allLogsLensActive });
const connectionForm = reactive<EventHubConnectionForm>(
  createInitialEventHubConnectionForm(runtimeConfig.public.defaultLookbackMinutes),
);
const { enabled: rememberConnectionString, lastError: connectionStringPersistenceError } =
  useEventHubConnectionPersistence(toRef(connectionForm, "connectionString"), {
    active: computed(() => capabilities.value?.mode === "anonymous"),
  });
const connecting = ref(false);
const sidebarCollapsed = ref(false);
const detailOpen = ref(false);
const selectedLog = ref<FirewallLogRecord | null>(null);
const toast = useToast();
const requestFetch = useRequestFetch();
const temporaryLogAnalyticsAuth = useTemporaryLogAnalyticsAuth();
const temporaryTenantId = ref("");
const temporaryWorkspaceId = ref("");
const temporaryTenants = ref<AzureAccessibleTenant[]>([]);
const temporaryWorkspaces = ref<AzureAccessibleWorkspace[]>([]);
const temporaryAzureUsername = ref("");
const temporaryLogAnalyticsAuthorizing = ref(false);
const temporaryAccessStatus = ref<"idle" | "loading" | "success" | "error">("idle");
const temporaryAccessError = ref<string | null>(null);
let temporaryAccessGeneration = 0;
let temporaryAuthorizationGeneration = 0;
const logHistory = useLogHistoryPersistence();
const ipCountryLookup = useIpCountryLookup();
watch(allLogsLensActive, (active) => ipCountryLookup.setActive(active), { immediate: true });
const clearingLogHistory = ref(false);
const logHistoryEnabled = computed(() => logHistory.enabled.value);
const logHistoryError = computed(() => logHistory.lastError.value);
const analysisMode = ref<AnalysisMode>(
  capabilities.value?.mode === "managed" && !capabilities.value.eventHubAvailable
    ? "log-analysis"
    : "real-time-analysis",
);
const logAnalysisActive = computed(() => analysisMode.value === "log-analysis");
const allLogsRealTimeActive = computed(
  () => !logAnalysisActive.value && activeLens.value === "all-logs",
);
const allLogsLogAnalysisActive = computed(
  () => logAnalysisActive.value && activeLens.value === "all-logs",
);
const dnsLensActive = computed(() => activeLens.value === "dns-troubleshooting");
const canUseLogAnalysis = logAnalyticsSourceAvailable;
const logAnalyticsRequirement = computed(() => {
  if (logAnalyticsSourceAvailable.value) {
    return null;
  }
  return managedMode.value
    ? "Log Analytics is not configured."
    : "Temporary Log Analytics app registration is not configured.";
});
const temporaryLogAnalyticsMode = computed(() => capabilities.value?.mode === "anonymous");
const temporaryTenantValid = computed(() => isEntraId(temporaryTenantId.value));
const temporaryWorkspaceValid = computed(() => isEntraId(temporaryWorkspaceId.value));
const temporaryAdminConsentUrl = computed(() =>
  import.meta.client
    ? createLogAnalyticsAdminConsentUrl(
        temporaryTenantId.value,
        runtimeConfig.public.logAnalyticsDelegated.clientId,
        window.location.origin,
      )
    : null,
);
const canRunLogAnalytics = computed(
  () =>
    managedMode.value ||
    (temporaryLogAnalyticsAuth.connected.value &&
      temporaryLogAnalyticsAuth.authorized.value &&
      temporaryTenantValid.value &&
      temporaryWorkspaceValid.value),
);
const dnsReadinessTarget = computed<DnsReadinessTarget | null>(() => {
  if (!import.meta.client) return null;
  if (managedMode.value && logAnalyticsSourceAvailable.value) {
    return { mode: "managed" };
  }
  if (
    temporaryLogAnalyticsMode.value &&
    temporaryLogAnalyticsAuth.connected.value &&
    temporaryLogAnalyticsAuth.authorized.value &&
    temporaryTenantValid.value &&
    temporaryWorkspaceValid.value
  ) {
    return {
      mode: "delegated",
      tenantId: temporaryTenantId.value.trim(),
      workspaceId: temporaryWorkspaceId.value.trim(),
    };
  }
  return null;
});

async function requestDnsReadiness(target: DnsReadinessTarget, signal: AbortSignal) {
  if (target.mode === "managed") {
    return requestFetch<DnsReadinessResponse>("/api/log-analytics/dns/readiness", { signal });
  }
  const accessToken = await temporaryLogAnalyticsAuth.getAccessToken(target.tenantId, false);
  return requestFetch<DnsReadinessResponse>("/api/log-analytics/delegated-dns/readiness", {
    body: { workspaceId: target.workspaceId },
    headers: { authorization: `Bearer ${accessToken}` },
    method: "POST",
    signal,
  });
}

const dnsSourceReadiness = useDnsSourceReadiness({
  request: requestDnsReadiness,
  target: dnsReadinessTarget,
});

function temporaryLogAnalyticsRunRequirement() {
  if (!temporaryLogAnalyticsAuth.connected.value) {
    return "Connect to Azure before running a query.";
  }
  if (!temporaryTenantValid.value || !temporaryWorkspaceValid.value) {
    return "Select an accessible workspace before running a query.";
  }
  return "Grant Log Analytics query permission before running a query.";
}

function requestTemporaryLogAnalytics(
  body: LogAnalyticsQueryRequest,
  signal: AbortSignal,
  accessToken: string,
  workspaceId: string,
) {
  return requestFetch<LogAnalyticsQueryResponse>("/api/log-analytics/delegated-query", {
    body: { ...body, workspaceId },
    headers: { authorization: `Bearer ${accessToken}` },
    method: "POST",
    signal,
  });
}

const realTimeQuery = useLogQuery(receiver.logs, {
  active: allLogsRealTimeActive,
  rawSource: {
    getRecords: receiver.getRawLogs,
    version: receiver.snapshotVersion,
  },
  visibleLimit: receiver.visibleLimit,
});
const realTimeSorting = useLogSorting(realTimeQuery.filteredLogs);
const logFilters = reactive(createDefaultLogFilters());
const logSort = reactive(createDefaultLogSort());
const logDraftRange = reactive(createDefaultLogAnalysisDateRange());
const logAnalyticsQueryLimit = ref(DEFAULT_LOG_ANALYTICS_QUERY_LIMIT);
const logQuery = useLogAnalyticsQuery({
  active: allLogsLogAnalysisActive,
  draftRange: logDraftRange,
  filters: logFilters,
  queryLimit: logAnalyticsQueryLimit,
  onBeforeReplace: closeDetail,
  onError: (message) => {
    toast.add({
      title: message,
      color: "error",
      icon: "i-lucide-circle-alert",
    });
  },
  request: async (body, signal) => {
    if (managedMode.value) {
      return requestFetch("/api/log-analytics/query", {
        body,
        method: "POST",
        signal,
      });
    }

    const tenantId = temporaryTenantId.value.trim();
    const workspaceId = temporaryWorkspaceId.value.trim();
    const accessToken = await temporaryLogAnalyticsAuth.getAccessToken(tenantId);
    return requestTemporaryLogAnalytics(body, signal, accessToken, workspaceId);
  },
  sort: logSort,
});
const {
  canApplyFilters: logCanApplyFilters,
  hasRun: logHasRun,
  appliedRange: logAppliedRange,
  rangeDirty: logRangeDirty,
  rangeError: logRangeError,
  refinementPending: logRefinementPending,
  status: logQueryStatus,
  truncated: logResultsTruncated,
} = logQuery;
const logResultQuery = useLogQuery(logQuery.records, {
  active: allLogsLogAnalysisActive,
  datasetKey: logQuery.datasetVersion,
  filters: logFilters,
  visibleLimit: logQuery.visibleLimit,
});
const logResultSorting = useLogSorting(logResultQuery.filteredLogs, false, logSort);
async function requestDnsList(body: DnsListQueryRequest, signal: AbortSignal) {
  if (managedMode.value) {
    return requestFetch<DnsListQueryResponse>("/api/log-analytics/dns/list", {
      body,
      method: "POST",
      signal,
    });
  }
  const tenantId = temporaryTenantId.value.trim();
  const workspaceId = temporaryWorkspaceId.value.trim();
  const accessToken = await temporaryLogAnalyticsAuth.getAccessToken(tenantId);
  return requestFetch<DnsListQueryResponse>("/api/log-analytics/delegated-dns/list", {
    body: { ...body, workspaceId },
    headers: { authorization: `Bearer ${accessToken}` },
    method: "POST",
    signal,
  });
}

async function requestDnsDetail(body: DnsDetailQueryRequest, signal: AbortSignal) {
  if (managedMode.value) {
    return requestFetch<DnsDetailQueryResponse>("/api/log-analytics/dns/detail", {
      body,
      method: "POST",
      signal,
    });
  }
  const tenantId = temporaryTenantId.value.trim();
  const workspaceId = temporaryWorkspaceId.value.trim();
  const accessToken = await temporaryLogAnalyticsAuth.getAccessToken(tenantId);
  return requestFetch<DnsDetailQueryResponse>("/api/log-analytics/delegated-dns/detail", {
    body: { ...body, workspaceId },
    headers: { authorization: `Bearer ${accessToken}` },
    method: "POST",
    signal,
  });
}

const dns = useDnsTroubleshooting({
  active: dnsLensActive,
  draftRange: logDraftRange,
  mode: analysisMode,
  queryLimit: logAnalyticsQueryLimit,
  receiver,
  requestDetail: requestDnsDetail,
  requestList: requestDnsList,
});
const dnsDetailOpen = computed({
  get: () => dns.selectedEntry.value !== null,
  set: (open: boolean) => {
    if (!open) dns.closeDetail();
  },
});
const modeState = useAnalysisMode({
  abortLogAnalysis: () => {
    logQuery.abort();
    dns.abort();
  },
  canUseLogAnalysis,
  canUseRealTime: eventHubSourceAvailable,
  closeDetail,
  disconnectRealTime: receiver.disconnect,
  mode: analysisMode,
  pauseRealTime: receiver.pause,
  resetRealTime: receiver.reset,
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
  activeLens.value === "dns-troubleshooting" && logAnalysisActive.value
    ? dns.status.value
    : logAnalysisActive.value
      ? logQuery.status.value
      : receiver.status.value,
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
const dnsCountLabel = computed(() => {
  const transportCount = dns.unidentifiedTransportCount.value;
  return `${dns.queriedEntryCount.value} queried entries · ${transportCount} unidentified ${
    transportCount === 1 ? "transport" : "transports"
  }`;
});
const logAppliedRangeLabel = computed(() => {
  if (logAppliedRange.value === null) {
    return "";
  }

  return `${formatTime(logAppliedRange.value.from)} to ${formatTime(logAppliedRange.value.to)}`;
});
const dnsAppliedRangeLabel = computed(() => {
  if (dns.appliedRange.value === null) return "";
  return `${formatTime(dns.appliedRange.value.from)} to ${formatTime(dns.appliedRange.value.to)}`;
});
const activeAppliedRangeLabel = computed(() =>
  activeLens.value === "dns-troubleshooting"
    ? dnsAppliedRangeLabel.value
    : logAppliedRangeLabel.value,
);
const activeQueryStatus = computed(() =>
  activeLens.value === "dns-troubleshooting" ? dns.status.value : logQueryStatus.value,
);
const activeRangeDirty = computed(() =>
  activeLens.value === "dns-troubleshooting" ? dns.rangeDirty.value : logRangeDirty.value,
);
const activeRangeError = computed(() =>
  activeLens.value === "dns-troubleshooting" ? dns.rangeError.value : logRangeError.value,
);
const activeResultsTruncated = computed(() =>
  activeLens.value === "dns-troubleshooting" ? dns.truncated.value : logResultsTruncated.value,
);
const parsedDetailSections = computed<DetailSection[]>(() => {
  const log = selectedLog.value;
  if (log === null) {
    return [];
  }

  const fields: DetailField[] = [
    { label: "Timestamp", value: formatTime(log.timestamp), mono: true },
    { label: "Category", value: log.category },
    { label: "Action", value: log.action },
    { label: "Protocol", value: formatIcmpProtocol(log.protocol) },
    { label: "Policy", value: log.policy },
    { label: "Rule collection group", value: log.ruleCollectionGroup },
    { label: "Rule collection", value: log.ruleCollection },
    { label: "Rule", value: log.rule },
    { label: "Source IP", value: log.sourceIp, mono: true },
    { label: "Source port", value: log.sourcePort, mono: true },
    {
      countryDestination: log.destinationIp,
      label: "Destination IP",
      value: log.destinationIp,
      mono: true,
    },
    { label: "Destination port", value: log.destinationPort, mono: true },
  ];

  const sections: DetailSection[] = [{ fields }];

  if (!logAnalysisActive.value) {
    const eventHubFields: DetailField[] = [
      { label: "Sequence", value: log.sequenceNumber, mono: true },
      {
        label: "Enqueued",
        value: log.enqueuedTimeUtc ? formatTime(log.enqueuedTimeUtc) : undefined,
        mono: true,
      },
    ].filter((field) => field.value !== undefined && field.value !== "");

    if (eventHubFields.length > 0) {
      sections.push({ fields: eventHubFields, title: "Event Hub metadata" });
    }
  }

  return sections;
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
          description: managedMode.value
            ? "Connect to configured Event Hub."
            : "Connect to an Event Hub with a Listen-only SAS connection string.",
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

watch(
  managedMode,
  (managed) => {
    if (managed) {
      connectionForm.connectionString = "";
      connectionForm.eventHubName = "";
      rememberConnectionString.value = false;
    }
  },
  { immediate: true },
);

async function connect() {
  if (modeTransitioning.value || logAnalysisActive.value) {
    return;
  }

  connecting.value = true;
  try {
    await receiver.connect(connectionForm, managedMode.value ? "managed" : "manual");
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

function updateDnsFilters(value: DnsFilters) {
  Object.assign(dns.filters.value, value);
}

function updateDnsSort(value: DnsSort) {
  Object.assign(dns.sort.value, value);
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

function commitLogAnalysisInteraction(event: Event) {
  if (!logAnalysisActive.value) return;
  const target = event.target;
  if (
    !(target instanceof Element) ||
    !target.closest(
      'a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="combobox"], [role="switch"], [role="textbox"]',
    )
  ) {
    return;
  }
  void modeState.commitLogAnalysis();
}

function closeDetail() {
  detailOpen.value = false;
  selectedLog.value = null;
  dns.closeDetail();
}

function setLens(lens: LogsLens) {
  if (activeLens.value === lens) return;
  closeDetail();
  activeLens.value = lens;
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
  if (activeLens.value === "dns-troubleshooting") {
    dns.clearActiveDataset();
    return;
  }
  if (logAnalysisActive.value) {
    logQuery.clear();
    return;
  }
  receiver.clear();
}

async function runLogAnalysis() {
  if (!canRunLogAnalytics.value) {
    toast.add({
      title: temporaryLogAnalyticsRunRequirement(),
      color: "error",
      icon: "i-lucide-circle-alert",
    });
    return;
  }
  if (temporaryLogAnalyticsMode.value) {
    const tenantId = temporaryTenantId.value.trim();
    const workspaceId = temporaryWorkspaceId.value.trim();
    try {
      const accessToken = await temporaryLogAnalyticsAuth.getAccessToken(tenantId, false);
      await logQuery.run((body, signal) =>
        requestTemporaryLogAnalytics(body, signal, accessToken, workspaceId),
      );
    } catch {
      toast.add({
        title: temporaryLogAnalyticsAuth.lastError.value ?? "Azure authentication failed.",
        color: "error",
        icon: "i-lucide-circle-alert",
      });
      return;
    }
    return;
  }
  await logQuery.run();
}

async function runDnsAnalysis() {
  if (!canRunLogAnalytics.value) {
    toast.add({
      title: temporaryLogAnalyticsRunRequirement(),
      color: "error",
      icon: "i-lucide-circle-alert",
    });
    return;
  }
  if (temporaryLogAnalyticsMode.value) {
    try {
      await temporaryLogAnalyticsAuth.getAccessToken(temporaryTenantId.value.trim(), false);
    } catch {
      toast.add({
        title: temporaryLogAnalyticsAuth.lastError.value ?? "Azure authentication failed.",
        color: "error",
        icon: "i-lucide-circle-alert",
      });
      return;
    }
  }
  await dns.run();
}

async function applyDnsFilters() {
  await dns.applyFilters();
}

function runActiveLogAnalysis() {
  return activeLens.value === "dns-troubleshooting" ? runDnsAnalysis() : runLogAnalysis();
}

async function disconnectTemporaryLogAnalytics() {
  temporaryAccessGeneration += 1;
  temporaryAuthorizationGeneration += 1;
  temporaryLogAnalyticsAuthorizing.value = false;
  logQuery.abort();
  logQuery.clear();
  dns.abort();
  dns.clearActiveDataset();
  temporaryTenantId.value = "";
  temporaryWorkspaceId.value = "";
  temporaryTenants.value = [];
  temporaryWorkspaces.value = [];
  temporaryAzureUsername.value = "";
  temporaryAccessStatus.value = "idle";
  temporaryAccessError.value = null;
  await temporaryLogAnalyticsAuth.disconnect();
}

async function authorizeTemporaryLogAnalytics() {
  if (!temporaryWorkspaceValid.value || temporaryLogAnalyticsAuthorizing.value) {
    return;
  }
  const generation = temporaryAuthorizationGeneration;
  const tenantId = temporaryTenantId.value.trim();
  const workspaceId = temporaryWorkspaceId.value.trim();
  temporaryLogAnalyticsAuthorizing.value = true;
  try {
    await temporaryLogAnalyticsAuth.getAccessToken(tenantId, true);
  } catch {
    if (
      generation !== temporaryAuthorizationGeneration ||
      tenantId !== temporaryTenantId.value.trim() ||
      workspaceId !== temporaryWorkspaceId.value.trim()
    ) {
      return;
    }
    toast.add({
      title: temporaryLogAnalyticsAuth.lastError.value ?? "Log Analytics authorization failed.",
      color: "error",
      icon: "i-lucide-circle-alert",
    });
  } finally {
    if (generation === temporaryAuthorizationGeneration) {
      temporaryLogAnalyticsAuthorizing.value = false;
    }
  }
}

async function checkTemporaryLogAnalyticsAuthorization() {
  const generation = ++temporaryAuthorizationGeneration;
  const tenantId = temporaryTenantId.value.trim();
  const workspaceId = temporaryWorkspaceId.value.trim();
  temporaryLogAnalyticsAuth.invalidateAuthorization();
  if (
    !temporaryLogAnalyticsAuth.connected.value ||
    !isEntraId(tenantId) ||
    !isEntraId(workspaceId)
  ) {
    temporaryLogAnalyticsAuthorizing.value = false;
    return;
  }
  temporaryLogAnalyticsAuthorizing.value = true;
  await temporaryLogAnalyticsAuth.checkAuthorization(tenantId);
  if (generation === temporaryAuthorizationGeneration) {
    temporaryLogAnalyticsAuthorizing.value = false;
  }
}

function selectTemporaryWorkspace(workspaceId: string) {
  if (workspaceId === temporaryWorkspaceId.value) return;
  logQuery.abort();
  logQuery.clear();
  dns.abort();
  dns.clearActiveDataset();
  temporaryWorkspaceId.value = workspaceId;
  void checkTemporaryLogAnalyticsAuthorization();
}

function mergeCurrentTenant(tenants: AzureAccessibleTenant[], tenantId: string) {
  if (tenants.some((tenant) => tenant.tenantId === tenantId)) {
    return tenants;
  }
  return [...tenants, { defaultDomain: null, displayName: tenantId, tenantId }];
}

async function discoverTemporaryAzureAccess(
  tenantId: string,
  getAccessToken: () => Promise<string>,
) {
  const generation = ++temporaryAccessGeneration;
  temporaryTenantId.value = tenantId;
  selectTemporaryWorkspace("");
  temporaryWorkspaces.value = [];
  temporaryAccessStatus.value = "loading";
  temporaryAccessError.value = null;
  try {
    const accessToken = await getAccessToken();
    const access = await requestFetch<AzureLogAnalyticsAccess>(
      "/api/log-analytics/delegated-access",
      { headers: { authorization: `Bearer ${accessToken}` } },
    );
    if (generation !== temporaryAccessGeneration || temporaryTenantId.value !== tenantId) {
      return;
    }
    temporaryTenants.value = mergeCurrentTenant(access.tenants, tenantId);
    temporaryWorkspaces.value = access.workspaces;
    if (access.workspaces.length === 1) {
      selectTemporaryWorkspace(access.workspaces[0]?.workspaceId ?? "");
    }
    temporaryAccessStatus.value = "success";
  } catch {
    if (generation !== temporaryAccessGeneration) {
      return;
    }
    temporaryAccessStatus.value = "error";
    temporaryAccessError.value = "Could not discover Azure directories and workspaces.";
  }
}

async function connectTemporaryLogAnalytics() {
  const connection = await temporaryLogAnalyticsAuth.connect();
  if (!connection) {
    return;
  }
  temporaryAzureUsername.value = connection.username;
  await discoverTemporaryAzureAccess(connection.tenantId, async () => connection.accessToken);
}

function changeTemporaryTenant(tenantId: string) {
  if (!isEntraId(tenantId) || tenantId === temporaryTenantId.value) {
    return;
  }
  void discoverTemporaryAzureAccess(tenantId, () =>
    temporaryLogAnalyticsAuth.getManagementAccessToken(tenantId),
  );
}

function changeTemporaryWorkspace(workspaceId: string) {
  if (isEntraId(workspaceId)) {
    selectTemporaryWorkspace(workspaceId);
  }
}

function refreshTemporaryAzureAccess() {
  if (!temporaryTenantValid.value) {
    return;
  }
  void discoverTemporaryAzureAccess(temporaryTenantId.value, () =>
    temporaryLogAnalyticsAuth.getManagementAccessToken(temporaryTenantId.value),
  );
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
      <div class="flex min-w-0 flex-wrap items-center gap-3">
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
                :aria-describedby="!eventHubSourceAvailable ? 'event-hub-requirement' : undefined"
                :disabled="!eventHubSourceAvailable || modeTransitioning"
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
            v-if="!eventHubSourceAvailable"
            id="event-hub-requirement"
            class="text-xs text-brand-gray-600 dark:text-brand-gray-300"
          >
            Live Event Hub is not configured.
          </p>
          <p
            v-if="logAnalyticsRequirement"
            id="log-analytics-requirement"
            class="text-xs text-brand-gray-600 dark:text-brand-gray-300"
          >
            {{ logAnalyticsRequirement }}
          </p>
        </div>
        <div class="ml-auto flex shrink-0 items-center gap-3">
          <span
            id="logs-lens-label"
            class="text-xs font-semibold tracking-wide text-brand-gray-600 uppercase dark:text-brand-gray-300"
          >
            View
          </span>
          <div role="group" aria-labelledby="logs-lens-label" class="shrink-0">
            <UFieldGroup size="sm">
              <UButton
                :variant="activeLens === 'all-logs' ? 'solid' : 'outline'"
                :color="activeLens === 'all-logs' ? 'primary' : 'neutral'"
                :aria-pressed="activeLens === 'all-logs'"
                @click="setLens('all-logs')"
              >
                All logs
              </UButton>
              <UButton
                :variant="activeLens === 'dns-troubleshooting' ? 'solid' : 'outline'"
                :color="activeLens === 'dns-troubleshooting' ? 'primary' : 'neutral'"
                :aria-pressed="activeLens === 'dns-troubleshooting'"
                @click="setLens('dns-troubleshooting')"
              >
                DNS troubleshooting
              </UButton>
            </UFieldGroup>
          </div>
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
        icon="i-lucide-settings"
        aria-label="Expand sidebar"
        color="neutral"
        variant="outline"
        square
        size="md"
        class="absolute top-1/2 right-2 z-20 -translate-y-1/2 rounded-full bg-white dark:bg-brand-gray-950"
        @click="expandSidebar"
      />

      <aside
        v-show="!sidebarCollapsed"
        class="relative flex max-h-80 min-h-0 flex-col border-b border-brand-gray-300 bg-white dark:border-brand-gray-700 dark:bg-brand-gray-950 lg:order-2 lg:max-h-none lg:border-b-0 lg:border-l"
      >
        <UButton
          icon="i-lucide-settings"
          aria-label="Collapse sidebar"
          color="neutral"
          variant="outline"
          square
          size="md"
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
            :managed="managedMode"
            :mode-transitioning="modeTransitioning"
            @update:connection-form="updateConnectionForm"
            @connect="connect"
            @disconnect="receiver.disconnect"
            @update-log-retention="updateLogRetention"
          />
          <div
            v-else
            @click.capture="commitLogAnalysisInteraction"
            @input.capture="commitLogAnalysisInteraction"
            @change.capture="commitLogAnalysisInteraction"
          >
            <LogsLogAnalyticsSettingsPanel
              v-model:tenant-id="temporaryTenantId"
              v-model:workspace-id="temporaryWorkspaceId"
              v-model:query-limit="logAnalyticsQueryLimit"
              :admin-consent-url="temporaryAdminConsentUrl"
              :dns-readiness="dnsSourceReadiness.readiness.value"
              :dns-readiness-status="dnsSourceReadiness.status.value"
              :lens="activeLens"
              :temporary="temporaryLogAnalyticsMode"
              :temporary-auth-error="temporaryLogAnalyticsAuth.lastError.value"
              :temporary-auth-status="temporaryLogAnalyticsAuth.status.value"
              :temporary-access-error="temporaryAccessError"
              :temporary-access-status="temporaryAccessStatus"
              :temporary-log-analytics-authorized="temporaryLogAnalyticsAuth.authorized.value"
              :temporary-log-analytics-authorizing="temporaryLogAnalyticsAuthorizing"
              :temporary-azure-username="temporaryAzureUsername"
              :tenant-options="temporaryTenants"
              :workspace-options="temporaryWorkspaces"
              @change-tenant="changeTemporaryTenant"
              @change-workspace="changeTemporaryWorkspace"
              @connect-azure="connectTemporaryLogAnalytics"
              @disconnect-azure="disconnectTemporaryLogAnalytics"
              @authorize-log-analytics="authorizeTemporaryLogAnalytics"
              @refresh-azure-access="refreshTemporaryAzureAccess"
            />
          </div>
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
        v-if="activeLens === 'all-logs'"
        class="flex min-h-0 flex-col overflow-hidden bg-brand-gray-50 dark:bg-brand-gray-950 lg:order-1"
        @click.capture="commitLogAnalysisInteraction"
        @input.capture="commitLogAnalysisInteraction"
        @change.capture="commitLogAnalysisInteraction"
      >
        <div class="shrink-0 bg-white dark:bg-brand-gray-950">
          <div
            role="group"
            aria-label="All logs status and actions"
            class="flex flex-wrap items-center justify-between gap-3 border-b border-brand-gray-300 px-4 py-3 dark:border-brand-gray-700"
          >
            <div class="flex flex-wrap items-center gap-3">
              <UBadge
                :color="statusColor(activeStatus)"
                variant="subtle"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
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
            <div class="ml-auto flex shrink-0 gap-2">
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

          <LogsLogAnalysisToolbar>
            <template #filters>
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
              <LogsLogFilterActions
                :show-apply="logAnalysisActive"
                :apply-disabled="!logCanApplyFilters || logRangeDirty"
                :apply-loading="logQueryStatus === 'refreshing'"
                @apply="applyLogFilters"
                @reset="resetActiveFilters"
              />
            </template>
            <template v-if="logAnalysisActive" #query>
              <LogsLogAnalyticsQueryControls
                :draft-range="logDraftRange"
                :applied-range-label="activeAppliedRangeLabel"
                :can-run="canRunLogAnalytics"
                :query-status="activeQueryStatus"
                :range-dirty="activeRangeDirty"
                :range-error="activeRangeError"
                :results-truncated="activeResultsTruncated"
                @update:draft-range="updateLogDraftRange"
                @run="runActiveLogAnalysis"
              />
            </template>
          </LogsLogAnalysisToolbar>
        </div>

        <div class="min-h-0 flex-1 overflow-hidden bg-white p-4 dark:bg-brand-gray-950">
          <div
            role="table"
            aria-label="Firewall logs"
            class="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-brand-gray-200 dark:border-brand-gray-700"
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
      <section
        v-else
        class="flex min-h-0 flex-col overflow-hidden bg-white dark:bg-brand-gray-950 lg:order-1"
        @click.capture="commitLogAnalysisInteraction"
        @input.capture="commitLogAnalysisInteraction"
        @change.capture="commitLogAnalysisInteraction"
      >
        <div
          role="group"
          aria-label="DNS troubleshooting status and actions"
          class="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-brand-gray-300 px-4 py-3 dark:border-brand-gray-700"
        >
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
            <span class="text-sm text-brand-gray-600 dark:text-brand-gray-300">
              {{ dnsCountLabel }}
            </span>
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
          </div>
          <div class="ml-auto flex shrink-0 gap-2">
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
              label="Clear DNS results"
              @click="clearActiveResults"
            />
          </div>
        </div>
        <LogsDnsTroubleshootingView
          :filters="dns.filters.value"
          :sort="dns.sort.value"
          :entries="dns.entries.value"
          :sources="dns.sources.value"
          :status="dns.status.value"
          :error="dns.lastError.value"
          :entries-truncated="dns.entriesTruncated.value"
          :transports-truncated="dns.transportsTruncated.value"
          v-model:show-unidentified-transports="dns.showUnidentifiedTransports.value"
          :log-analysis="logAnalysisActive"
          :can-apply-filters="dns.canApplyFilters.value"
          :filter-options="dns.filterOptions.value"
          :selected-entry-id="dns.selectedEntry.value?.id ?? null"
          @update:filters="updateDnsFilters"
          @update:sort="updateDnsSort"
          @apply="applyDnsFilters"
          @reset="dns.resetFilters"
          @select="dns.selectEntry"
        >
          <template v-if="logAnalysisActive" #query-controls>
            <LogsLogAnalyticsQueryControls
              :draft-range="logDraftRange"
              :applied-range-label="activeAppliedRangeLabel"
              :can-run="canRunLogAnalytics"
              :query-status="activeQueryStatus"
              :range-dirty="activeRangeDirty"
              :range-error="activeRangeError"
              :results-truncated="activeResultsTruncated"
              @update:draft-range="updateLogDraftRange"
              @run="runActiveLogAnalysis"
            />
          </template>
        </LogsDnsTroubleshootingView>
      </section>
    </div>

    <UModal
      v-if="activeLens === 'all-logs'"
      v-model:open="detailOpen"
      title="Log detail"
      :ui="{ content: 'select-none', body: 'select-none' }"
      @after:leave="clearClosedDetail"
    >
      <template #body>
        <div v-if="selectedLog" class="space-y-4">
          <section
            v-for="(section, sectionIndex) in parsedDetailSections"
            :key="section.title ?? sectionIndex"
            class="space-y-3"
          >
            <div v-if="section.title" class="flex items-center gap-3">
              <h3
                class="shrink-0 text-xs font-semibold tracking-wide text-brand-gray-600 uppercase dark:text-brand-gray-300"
              >
                {{ section.title }}
              </h3>
              <div class="h-px flex-1 bg-brand-gray-200 dark:bg-brand-gray-700" />
            </div>
            <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
              <div
                v-for="field in section.fields"
                :key="field.label"
                :class="field.wide ? 'sm:col-span-2' : ''"
              >
                <dt class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                  {{ field.label }}
                </dt>
                <dd
                  class="mt-1 flex min-w-0 items-center gap-2 text-brand-gray-950 dark:text-brand-gray-50"
                >
                  <DestinationCountryFlag
                    v-if="field.countryDestination"
                    :destination="field.countryDestination"
                    :lookup="ipCountryLookup"
                  />
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
          </section>
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
    <LogsDnsDetailModal
      v-model:open="dnsDetailOpen"
      :entry="dns.selectedEntry.value"
      :detail="dns.detail.value"
      :error="dns.detailError.value"
      :loading="dns.detailStatus.value === 'loading'"
    />
  </div>
</template>
