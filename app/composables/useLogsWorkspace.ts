import { useMediaQuery } from '@vueuse/core'

import type {
  DnsDetailQueryRequest,
  DnsDetailQueryResponse,
  DnsFilters,
  DnsListQueryRequest,
  DnsListQueryResponse,
  DnsReadinessResponse,
  DnsSort,
} from '#shared/types/dns'
import type { FirewallLogRecord, FirewallLogSortKey } from '#shared/types/firewall'
import type { LogAnalyticsQueryResponse, LogAnalyticsStorageKind } from '#shared/types/logAnalytics'
import { hasDnsReadinessData } from '#shared/utils/dnsReadiness'
import { DEFAULT_LOG_ANALYTICS_QUERY_LIMIT } from '#shared/utils/logAnalytics'
import type { AnalysisMode } from '~/composables/useAnalysisMode'
import type { DnsReadinessTarget } from '~/composables/useDnsSourceReadiness'
import {
  createDefaultLogFilters,
  isLogCategoryFilterValueActive,
  isLogFilterValueActive,
  toggleLogCategoryFilterValue,
  toggleLogFilterValue,
} from '~/composables/useLogQuery'
import { createDefaultLogSort } from '~/composables/useLogSorting'
import type { LogQuickFilterKey, MobileQueryState } from '~/types/logs'
import type { EventHubConnectionForm } from '~/utils/eventHubConnection'
import { validateEventHubConnectionForm } from '~/utils/eventHubConnection'
import {
  createDefaultLogAnalysisDateRange,
  formatDateTimeUtc,
  formatLogAnalysisRange,
  LOG_ANALYSIS_CATEGORIES,
} from '~/utils/logAnalysis'
import type { LogAnalysisDateRange, LogAnalysisRangePreset } from '~/utils/logAnalysis'
import { logFilterCount, logFilterSummary, logStatusTone } from '~/utils/logFilterPresentation'

export function useLogsWorkspace() {
  interface LogTableColumn {
    key: FirewallLogSortKey
    label: string
  }

  interface LogsEmptyState {
    description: string
    settingsActionLabel?: string
    title: string
  }

  type LogsLens = 'all-logs' | 'dns-troubleshooting'

  const {
    browserTimeZone: logBrowserTimeZone,
    formatTimestamp: formatLogTimestamp,
    hourCycle: logHourCycle,
    lastError: logTimeFormatError,
    timeZone: logTimeZone,
    use12Hour: use12HourTime,
    useLocalTime,
  } = useLogTimeFormat()
  const logTableColumns = computed<LogTableColumn[]>(() => [
    { key: 'timestamp', label: `Date (${logTimeZone.value})` },
    { key: 'category', label: 'Category' },
    { key: 'action', label: 'Action' },
    { key: 'protocol', label: 'Protocol' },
    { key: 'sourceIp', label: 'Source' },
    { key: 'sourcePort', label: 'Src port' },
    { key: 'destinationIp', label: 'Destination' },
    { key: 'destinationPort', label: 'Dst port' },
    { key: 'rule', label: 'Rule' },
  ])
  const runtimeConfig = useRuntimeConfig()
  const deployment = useDeploymentCapabilities()
  const capabilities = computed(() => deployment.capabilities.value)
  const managedMode = computed(() => capabilities.value?.mode === 'managed')
  const eventHubSourceAvailable = computed(
    () =>
      capabilities.value?.mode === 'anonymous' || capabilities.value?.eventHubAvailable === true,
  )
  const logAnalyticsSourceAvailable = computed(() =>
    capabilities.value?.mode === 'anonymous'
      ? capabilities.value.temporaryLogAnalyticsAuthAvailable
      : capabilities.value?.predefinedLogAnalyticsAvailable === true,
  )
  const activeLens = ref<LogsLens>('all-logs')
  const isMobile = useMediaQuery('(max-width: 1023px)')
  const isPhone = useMediaQuery('(max-width: 640px)')
  const logToolbar = useTemplateRef<{ openFilters: () => void; runStarted: () => void }>(
    'logToolbar',
  )
  const dnsView = useTemplateRef<{ restoreFocus: () => void }>('dnsView')
  const allLogsLensActive = computed(() => activeLens.value === 'all-logs')
  const receiver = useEventHubReceiver({ uiPublishingEnabled: allLogsLensActive })
  const connectionForm = reactive<EventHubConnectionForm>(
    createInitialEventHubConnectionForm(runtimeConfig.public.defaultLookbackMinutes),
  )
  const { enabled: rememberConnectionString, lastError: connectionStringPersistenceError } =
    useEventHubConnectionPersistence(toRef(connectionForm, 'connectionString'), {
      active: computed(() => capabilities.value?.mode === 'anonymous'),
    })
  const connecting = ref(false)
  const eventHubConnectionActive = computed(
    () =>
      receiver.status.value === 'connected' ||
      receiver.status.value === 'reconnecting' ||
      receiver.status.value === 'paused',
  )
  const {
    open: settingsOpen,
    show: openSettings,
    restore: restoreSettingsFocus,
  } = useLogsSettingsDrawer()
  const detailOpen = ref(false)
  const selectedLog = ref<FirewallLogRecord | null>(null)
  const toast = useToast()
  const requestFetch = useRequestFetch()
  const {
    temporaryLogAnalyticsAuth,
    temporaryLogAnalyticsClient,
    temporaryTenantId,
    temporaryWorkspaceId,
    temporaryTenants,
    temporaryWorkspaces,
    temporaryAzureUsername,
    temporaryLogAnalyticsAuthorizing,
    temporaryAccessStatus,
    temporaryAccessError,
    temporaryTenantValid,
    temporaryWorkspaceValid,
    temporaryAdminConsentUrl,
    disconnectTemporaryLogAnalytics,
    authorizeTemporaryLogAnalytics,
    connectTemporaryLogAnalytics,
    changeTemporaryTenant,
    changeTemporaryWorkspace,
    refreshTemporaryAzureAccess,
  } = useTemporaryLogAnalyticsWorkspace({
    onWorkspaceChange: clearLogAnalyticsWorkspace,
  })
  const logHistory = useLogHistoryPersistence()
  const ipCountryLookup = useIpCountryLookup()
  watch(
    allLogsLensActive,
    (active) => {
      ipCountryLookup.setActive(active)
    },
    { immediate: true },
  )
  const clearingLogHistory = ref(false)
  const logHistoryEnabled = computed(() => logHistory.enabled.value)
  const logHistoryError = computed(() => logHistory.lastError.value)
  const analysisMode = ref<AnalysisMode>('real-time-analysis')
  watch(
    capabilities,
    (current) => {
      if (current?.mode === 'managed' && !current.eventHubAvailable) {
        analysisMode.value = 'log-analysis'
      }
    },
    { immediate: true, once: true },
  )
  const logAnalysisActive = computed(() => analysisMode.value === 'log-analysis')
  const allLogsRealTimeActive = computed(
    () => !logAnalysisActive.value && activeLens.value === 'all-logs',
  )
  const allLogsLogAnalysisActive = computed(
    () => logAnalysisActive.value && activeLens.value === 'all-logs',
  )
  const dnsLensActive = computed(() => activeLens.value === 'dns-troubleshooting')
  const canUseLogAnalysis = logAnalyticsSourceAvailable
  const logAnalyticsRequirement = computed(() => {
    if (logAnalyticsSourceAvailable.value) {
      return null
    }
    return managedMode.value
      ? 'Log Analytics is not configured.'
      : 'Temporary Log Analytics app registration is not configured.'
  })
  const temporaryLogAnalyticsMode = computed(() => capabilities.value?.mode === 'anonymous')
  const canRunLogAnalytics = computed(
    () =>
      managedMode.value ||
      (temporaryLogAnalyticsAuth.connected.value &&
        temporaryLogAnalyticsAuth.authorized.value &&
        temporaryTenantValid.value &&
        temporaryWorkspaceValid.value),
  )
  const dnsReadinessTarget = computed<DnsReadinessTarget | null>(() => {
    if (!import.meta.client) {
      return null
    }
    if (managedMode.value && logAnalyticsSourceAvailable.value) {
      return { mode: 'managed' }
    }
    if (
      temporaryLogAnalyticsMode.value &&
      temporaryLogAnalyticsAuth.connected.value &&
      temporaryLogAnalyticsAuth.authorized.value &&
      temporaryTenantValid.value &&
      temporaryWorkspaceValid.value
    ) {
      return {
        mode: 'delegated',
        tenantId: temporaryTenantId.value.trim(),
        workspaceId: temporaryWorkspaceId.value.trim(),
      }
    }
    return null
  })

  async function requestDnsReadiness(target: DnsReadinessTarget, signal: AbortSignal) {
    if (target.mode === 'managed') {
      return await requestFetch<DnsReadinessResponse>('/api/log-analytics/dns/readiness', {
        signal,
      })
    }
    return await temporaryLogAnalyticsClient.dnsReadiness(
      target.tenantId,
      target.workspaceId,
      signal,
    )
  }

  const dnsSourceReadiness = useDnsSourceReadiness({
    request: requestDnsReadiness,
    target: dnsReadinessTarget,
  })

  function temporaryLogAnalyticsRunRequirement() {
    if (!temporaryLogAnalyticsAuth.connected.value) {
      return 'Connect to Azure before running a query.'
    }
    if (!temporaryTenantValid.value || !temporaryWorkspaceValid.value) {
      return 'Select an accessible workspace before running a query.'
    }
    return 'Grant Log Analytics query permission before running a query.'
  }

  const realTimeQuery = useLogQuery(receiver.logs, {
    active: allLogsRealTimeActive,
    rawSource: {
      getRecords: receiver.getRawLogs,
      version: receiver.snapshotVersion,
    },
    visibleLimit: receiver.visibleLimit,
  })
  const realTimeSorting = useLogSorting(realTimeQuery.filteredLogs)
  const logFilters = reactive(createDefaultLogFilters())
  const logSort = reactive(createDefaultLogSort())
  const logDraftRange = reactive(createDefaultLogAnalysisDateRange())
  const logRangePreset = ref<LogAnalysisRangePreset>('15')
  const logAnalyticsQueryLimit = ref(DEFAULT_LOG_ANALYTICS_QUERY_LIMIT)
  const logAnalyticsStorage = ref<LogAnalyticsStorageKind>('resource-specific')
  watch(
    dnsReadinessTarget,
    () => {
      logAnalyticsStorage.value = 'resource-specific'
    },
    { flush: 'sync' },
  )
  watch([dnsSourceReadiness.readiness, dnsSourceReadiness.status], ([readiness, status]) => {
    if (status !== 'success') {
      return
    }
    const resourceSpecificHasData = hasDnsReadinessData(readiness, 'resource-specific')
    const azureDiagnosticsHasData = hasDnsReadinessData(readiness, 'azure-diagnostics')
    if (azureDiagnosticsHasData && !resourceSpecificHasData) {
      logAnalyticsStorage.value = 'azure-diagnostics'
    } else if (!azureDiagnosticsHasData) {
      logAnalyticsStorage.value = 'resource-specific'
    }
  })
  const logQuery = useLogAnalyticsQuery({
    active: allLogsLogAnalysisActive,
    draftRange: logDraftRange,
    rangePreset: logRangePreset,
    filters: logFilters,
    queryLimit: logAnalyticsQueryLimit,
    onBeforeReplace: closeDetail,
    request: async (body, signal) => {
      if (managedMode.value) {
        return await requestFetch<LogAnalyticsQueryResponse>('/api/log-analytics/query', {
          body,
          method: 'POST',
          signal,
        })
      }

      const tenantId = temporaryTenantId.value.trim()
      const workspaceId = temporaryWorkspaceId.value.trim()
      return await temporaryLogAnalyticsClient.query(tenantId, workspaceId, body, signal)
    },
    sort: logSort,
    storage: logAnalyticsStorage,
  })
  const {
    hasRun: logHasRun,
    appliedRange: logAppliedRange,
    rangeDirty: logRangeDirty,
    rangeError: logRangeError,
    status: logQueryStatus,
    truncated: logResultsTruncated,
  } = logQuery
  const logResultQuery = useLogQuery(logQuery.records, {
    active: allLogsLogAnalysisActive,
    datasetKey: logQuery.datasetVersion,
    filters: logQuery.appliedFilters,
    visibleLimit: logQuery.visibleLimit,
  })
  const logResultSorting = useLogSorting(logResultQuery.filteredLogs, logSort)
  async function requestDnsList(body: DnsListQueryRequest, signal: AbortSignal) {
    if (managedMode.value) {
      return await requestFetch<DnsListQueryResponse>('/api/log-analytics/dns/list', {
        body,
        method: 'POST',
        signal,
      })
    }
    const tenantId = temporaryTenantId.value.trim()
    const workspaceId = temporaryWorkspaceId.value.trim()
    return await temporaryLogAnalyticsClient.dnsList(tenantId, workspaceId, body, signal)
  }

  async function requestDnsDetail(body: DnsDetailQueryRequest, signal: AbortSignal) {
    if (managedMode.value) {
      return await requestFetch<DnsDetailQueryResponse>('/api/log-analytics/dns/detail', {
        body,
        method: 'POST',
        signal,
      })
    }
    const tenantId = temporaryTenantId.value.trim()
    const workspaceId = temporaryWorkspaceId.value.trim()
    return await temporaryLogAnalyticsClient.dnsDetail(tenantId, workspaceId, body, signal)
  }

  const dns = useDnsTroubleshooting({
    active: dnsLensActive,
    draftRange: logDraftRange,
    rangePreset: logRangePreset,
    mode: analysisMode,
    queryLimit: logAnalyticsQueryLimit,
    receiver,
    requestDetail: requestDnsDetail,
    requestList: requestDnsList,
    storage: logAnalyticsStorage,
  })
  function clearLogAnalyticsWorkspace() {
    logQuery.clear()
    dns.clearActiveDataset()
  }
  const dnsDetailOpen = computed({
    get: () => dns.selectedEntry.value !== null,
    set: (open: boolean) => {
      if (!open) {
        dns.closeDetail()
      }
    },
  })
  const modeState = useAnalysisMode({
    abortLogAnalysis: () => {
      logQuery.abort()
      dns.abort()
    },
    canUseLogAnalysis,
    canUseRealTime: eventHubSourceAvailable,
    closeDetail,
    disconnectRealTime: disconnectEventHub,
    mode: analysisMode,
    pauseRealTime: receiver.pause,
    resetRealTime: resetEventHub,
  })
  const modeTransitioning = modeState.transitioning
  const actionLabels: Record<string, string> = {
    allow: 'Allow',
    deny: 'Deny',
    dnat: 'DNAT',
    snat: 'SNAT',
  }

  const realTimeActions = computed(() => {
    return createCaseInsensitiveFilterOptions(
      receiver.actionOptions.value,
      (value) => actionLabels[value.toLowerCase()] ?? value,
    )
  })
  const realTimeProtocols = computed(() => {
    return createCaseInsensitiveFilterOptions(receiver.protocolOptions.value, (value) =>
      value.toUpperCase(),
    )
  })
  const activeFilters = computed({
    get: () => (logAnalysisActive.value ? logFilters : realTimeQuery.filters),
    set: (value) => {
      Object.assign(logAnalysisActive.value ? logFilters : realTimeQuery.filters, value)
    },
  })
  const sortedLogs = computed(() =>
    logAnalysisActive.value ? logResultSorting.sortedLogs.value : realTimeSorting.sortedLogs.value,
  )
  const activeFilterCount = computed(() => logFilterCount(activeFilters.value))
  const activeSort = computed({
    get: () => (logAnalysisActive.value ? logResultSorting.sort : realTimeSorting.sort),
    set: (value) => {
      Object.assign(logAnalysisActive.value ? logResultSorting.sort : realTimeSorting.sort, value)
    },
  })
  const categories = computed(() =>
    logAnalysisActive.value ? [...LOG_ANALYSIS_CATEGORIES] : receiver.categoryOptions.value,
  )
  const actions = computed(() =>
    logAnalysisActive.value ? logQuery.actionOptions.value : realTimeActions.value,
  )
  const protocols = computed(() =>
    logAnalysisActive.value ? logQuery.protocolOptions.value : realTimeProtocols.value,
  )
  const activeStatus = computed(() => {
    if (!logAnalysisActive.value) {
      return receiver.status.value
    }
    return activeLens.value === 'dns-troubleshooting' ? dns.status.value : logQuery.status.value
  })
  const showRealTimeLag = computed(
    () =>
      !logAnalysisActive.value &&
      (receiver.status.value === 'connected' || receiver.status.value === 'paused') &&
      receiver.latestSourceTimestamp.value !== null,
  )
  const countLabel = computed(() => {
    if (!logAnalysisActive.value) {
      return `${sortedLogs.value.length} visible / ${receiver.receivedCount.value} received`
    }

    const updating = logQuery.status.value === 'refreshing'
    const suffix = logQuery.truncated.value
      ? ` / first ${logQuery.limit.value?.toLocaleString() ?? ''}`
      : ''
    return `${sortedLogs.value.length} visible${suffix}${updating ? ' / updating' : ''}`
  })
  const dnsCountLabel = computed(
    () =>
      `${dns.queriedEntryCount.value} ${dns.queriedEntryCount.value === 1 ? 'entry' : 'entries'}${dns.unidentifiedTransportCount.value ? ` · ${dns.unidentifiedTransportCount.value} unidentified transports` : ''}`,
  )
  const activeQueryStatus = computed(() =>
    activeLens.value === 'dns-troubleshooting' ? dns.status.value : logQueryStatus.value,
  )
  const activeRangeDirty = computed(() =>
    activeLens.value === 'dns-troubleshooting' ? dns.rangeDirty.value : logRangeDirty.value,
  )
  const activeRangeError = computed(() =>
    activeLens.value === 'dns-troubleshooting' ? dns.rangeError.value : logRangeError.value,
  )
  const mobileAppliedRangeLabel = computed(() => {
    const range = dnsLensActive.value ? dns.appliedRange.value : logAppliedRange.value
    if (!range) {
      return ''
    }
    return formatLogAnalysisRange({
      from: formatDateTimeUtc(new Date(range.from)),
      to: formatDateTimeUtc(new Date(range.to)),
    })
  })
  const mobileQueryState = computed<MobileQueryState>(() => ({
    canRun: canRunLogAnalytics.value,
    hasRun: dnsLensActive.value ? dns.appliedRange.value !== null : logHasRun.value,
    dirty:
      activeRangeDirty.value ||
      (dnsLensActive.value ? dns.filtersDirty.value : logQuery.filtersDirty.value),
    status: activeQueryStatus.value,
    rangeError: activeRangeError.value,
    pendingMessage: 'Changes not applied.',
    error: dnsLensActive.value ? dns.lastError.value : logQuery.lastError.value,
  }))
  const mobileStatusLabel = computed(() => {
    if (logAnalysisActive.value && mobileQueryState.value.error) {
      return 'Query failed'
    }
    switch (activeStatus.value) {
      case 'idle': {
        return logAnalysisActive.value && canRunLogAnalytics.value
          ? 'Ready to query'
          : 'Not connected'
      }
      case 'connected': {
        return showRealTimeLag.value && !receiver.caughtUp.value ? 'Catching up' : 'Live'
      }
      case 'success': {
        return 'Results ready'
      }
      case 'loading': {
        return 'Running query'
      }
      case 'refreshing': {
        return 'Updating results'
      }
      case 'connecting': {
        return 'Connecting'
      }
      case 'reconnecting': {
        return 'Reconnecting'
      }
      case 'paused': {
        return 'Paused'
      }
      case 'error': {
        return logAnalysisActive.value ? 'Query failed' : 'Connection failed'
      }
      default: {
        return 'Disconnected'
      }
    }
  })
  const mobileSortKey = computed({
    get: () => activeSort.value.key,
    set: (key: FirewallLogSortKey) => {
      activeSort.value = { ...activeSort.value, key }
    },
  })
  function toggleMobileSortDirection() {
    activeSort.value = {
      ...activeSort.value,
      direction: activeSort.value.direction === 'desc' ? 'asc' : 'desc',
    }
  }

  const emptyState = computed<LogsEmptyState>(() => {
    if (!logAnalysisActive.value) {
      let description = 'Connect to an Event Hub with a Listen-only SAS connection string.'
      if (eventHubConnectionActive.value) {
        description = 'Waiting for firewall logs from the connected Event Hub.'
      } else if (managedMode.value) {
        description = 'Connect to configured Event Hub.'
      }
      return receiver.logs.value.length > 0
        ? {
            title: 'No matching logs',
            description: 'Adjust or reset the active filters.',
          }
        : {
            title: 'No logs received',
            description,
            settingsActionLabel:
              receiver.status.value === 'idle' || receiver.status.value === 'error'
                ? 'Open Event Hub settings'
                : undefined,
          }
    }

    if (!logQuery.hasRun.value) {
      return {
        title: 'Explore your firewall logs',
        description: canRunLogAnalytics.value
          ? 'Choose a time range to query your Log Analytics workspace.'
          : 'Connect your Azure workspace, then choose a time range to explore your logs.',
        settingsActionLabel: canRunLogAnalytics.value ? undefined : 'Open Log Analytics settings',
      }
    }
    if (logQuery.status.value === 'refreshing') {
      return {
        title: 'Updating results',
        description: 'Current filters are being applied in Log Analytics.',
      }
    }
    if (activeFilterCount.value || activeFilters.value.search) {
      return {
        title: 'No matching logs',
        description: 'No logs match the applied filters in this time range.',
      }
    }

    return {
      title: 'No logs in range',
      description: 'No Azure Firewall records were returned for applied time range.',
    }
  })

  watch(
    managedMode,
    (managed) => {
      if (managed) {
        connectionForm.connectionString = ''
        connectionForm.eventHubName = ''
        rememberConnectionString.value = false
      }
    },
    { immediate: true },
  )

  let connectionAttempt = 0
  async function connect() {
    if (modeTransitioning.value || logAnalysisActive.value) {
      return
    }

    const attempt = ++connectionAttempt
    connecting.value = true
    try {
      if (!managedMode.value && validateEventHubConnectionForm(connectionForm).length === 0) {
        clearTemporaryEventHubViewState()
      }
      await receiver.connect(connectionForm, managedMode.value ? 'managed' : 'manual')
    } finally {
      if (attempt === connectionAttempt) {
        connecting.value = false
      }
    }
  }

  function updateConnectionForm(value: EventHubConnectionForm) {
    Object.assign(connectionForm, value)
  }

  function updateLogDraftRange(value: LogAnalysisDateRange) {
    Object.assign(logDraftRange, value)
  }

  function updateDnsFilters(value: DnsFilters) {
    Object.assign(dns.filters.value, value)
  }

  function updateDnsSort(value: DnsSort) {
    Object.assign(dns.sort.value, value)
  }

  async function updateLogRetention(enabled: boolean) {
    if (enabled) {
      logHistory.enable()
      return
    }

    clearingLogHistory.value = true
    try {
      await logHistory.disableAndClearHistory()
    } finally {
      clearingLogHistory.value = false
    }
  }

  function commitLogAnalysisInteraction(event: Event) {
    if (!logAnalysisActive.value) {
      return
    }
    const target = event.target
    if (
      !(target instanceof Element) ||
      !target.closest(
        'a, button, input, select, textarea, [role="button"], [role="checkbox"], [role="combobox"], [role="switch"], [role="textbox"]',
      )
    ) {
      return
    }
    void modeState.commitLogAnalysis()
  }

  function closeDetail() {
    detailOpen.value = false
    selectedLog.value = null
    dns.closeDetail()
  }

  function clearTemporaryEventHubViewState() {
    if (analysisMode.value === 'real-time-analysis') {
      closeDetail()
    }
    realTimeQuery.resetFilters()
    dns.resetRealtimeFilters()
  }

  async function disconnectEventHub() {
    connectionAttempt += 1
    const temporarySession = !managedMode.value
    try {
      await receiver.disconnect()
    } finally {
      connecting.value = false
      if (temporarySession) {
        clearTemporaryEventHubViewState()
      }
    }
  }

  async function resetEventHub() {
    const temporarySession = !managedMode.value
    try {
      await receiver.reset()
    } finally {
      if (temporarySession) {
        realTimeQuery.resetFilters()
        dns.resetRealtimeFilters()
      }
    }
  }

  function setLens(lens: LogsLens) {
    if (activeLens.value === lens) {
      return
    }
    closeDetail()
    activeLens.value = lens
  }

  function resetActiveFilters() {
    if (logAnalysisActive.value) {
      Object.assign(logFilters, createDefaultLogFilters())
      return
    }
    realTimeQuery.resetFilters()
  }

  function setSort(key: FirewallLogSortKey) {
    if (logAnalysisActive.value) {
      logResultSorting.setSort(key)
      return
    }
    realTimeSorting.setSort(key)
  }

  function isQuickFilterActive(key: LogQuickFilterKey, value: string | undefined) {
    if (key === 'category') {
      return isLogCategoryFilterValueActive(activeFilters.value.category, value)
    }
    return isLogFilterValueActive(activeFilters.value[key], value)
  }

  function toggleQuickFilter(key: LogQuickFilterKey, value: string | undefined) {
    if (key === 'category') {
      activeFilters.value.category = toggleLogCategoryFilterValue(
        activeFilters.value.category,
        value,
      )
      return
    }
    activeFilters.value[key] = toggleLogFilterValue(activeFilters.value[key], value)
  }

  function clearActiveResults() {
    if (activeLens.value === 'dns-troubleshooting') {
      dns.clearActiveDataset()
      return
    }
    if (logAnalysisActive.value) {
      logQuery.clear()
      return
    }
    receiver.clear()
  }

  async function runLogAnalysis() {
    if (!canRunLogAnalytics.value) {
      toast.add({
        title: temporaryLogAnalyticsRunRequirement(),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
      return
    }
    if (
      logQuery.rangeError.value !== null ||
      logQueryStatus.value === 'loading' ||
      logQueryStatus.value === 'refreshing'
    ) {
      return
    }
    logToolbar.value?.runStarted()
    await logQuery.run()
  }

  async function runDnsAnalysis() {
    if (!canRunLogAnalytics.value) {
      toast.add({
        title: temporaryLogAnalyticsRunRequirement(),
        color: 'error',
        icon: 'i-lucide-circle-alert',
      })
      return
    }
    await dns.run()
  }

  async function runActiveLogAnalysis() {
    if (activeLens.value === 'dns-troubleshooting') {
      await runDnsAnalysis()
    } else {
      await runLogAnalysis()
    }
  }

  function selectLog(log: FirewallLogRecord) {
    selectedLog.value = { ...log }
    detailOpen.value = true
  }

  function clearClosedDetail() {
    if (!detailOpen.value) {
      selectedLog.value = null
    }
  }

  async function restoreDnsFocus(event: Event) {
    const view = dnsView.value
    if (view) {
      event.preventDefault()
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          resolve()
        })
      })
      await nextTick()
      view.restoreFocus()
    }
  }

  const appliedFilterSummary = computed(() => {
    if (logAnalysisActive.value && !logHasRun.value) {
      const summary = logFilterSummary(logFilters, formatLogAnalysisRange(logDraftRange), false)
      return summary.map((line, index) =>
        index === 0 ? line.replace('Applied ·', 'Query ·') : line,
      )
    }
    return logFilterSummary(
      logAnalysisActive.value ? logQuery.appliedFilters : activeFilters.value,
      logAnalysisActive.value ? mobileAppliedRangeLabel.value : '',
      !logAnalysisActive.value,
    )
  })
  const sourceItems = computed(() => [
    {
      value: 'real-time-analysis' as const,
      label: 'Live Event Hub',
      icon: 'i-lucide-radio',
      disabled: !eventHubSourceAvailable.value || modeTransitioning.value,
      description: eventHubSourceAvailable.value ? undefined : 'Live Event Hub is not configured.',
    },
    {
      value: 'log-analysis' as const,
      label: 'Log Analytics',
      icon: 'i-lucide-chart-no-axes-combined',
      disabled: !canUseLogAnalysis.value || modeTransitioning.value,
      description: logAnalyticsRequirement.value ?? undefined,
    },
  ])
  const lensItems = [
    { value: 'all-logs' as const, label: 'All logs' },
    { value: 'dns-troubleshooting' as const, label: 'DNS troubleshooting' },
  ]
  const statusTone = computed(() => {
    if (logAnalysisActive.value && mobileQueryState.value.error) {
      return 'error'
    }
    if (!logAnalysisActive.value && showRealTimeLag.value && !receiver.caughtUp.value) {
      return 'warning'
    }
    if (
      dnsLensActive.value &&
      (dns.entriesTruncated.value ||
        dns.transportsTruncated.value ||
        dns.sources.value.some((source) => source.availability !== 'available'))
    ) {
      return 'warning'
    }
    return logStatusTone(activeStatus.value)
  })
  function selectMode(mode: AnalysisMode) {
    void modeState.setMode(mode)
  }
  function togglePause() {
    if (receiver.status.value === 'paused') {
      receiver.resume()
    } else {
      receiver.pause()
    }
  }

  return {
    actions,
    activeFilterCount,
    activeFilters,
    activeLens,
    activeSort,
    allLogsLensActive,
    analysisMode,
    appliedFilterSummary,
    authorizeTemporaryLogAnalytics,
    categories,
    changeTemporaryTenant,
    changeTemporaryWorkspace,
    clearActiveResults,
    clearClosedDetail,
    clearingLogHistory,
    commitLogAnalysisInteraction,
    connect,
    connectTemporaryLogAnalytics,
    connecting,
    connectionForm,
    connectionStringPersistenceError,
    countLabel,
    detailOpen,
    disconnectEventHub,
    disconnectTemporaryLogAnalytics,
    dns,
    dnsCountLabel,
    dnsDetailOpen,
    dnsLensActive,
    dnsSourceReadiness,
    dnsView,
    emptyState,
    eventHubConnectionActive,
    formatLogTimestamp,
    ipCountryLookup,
    isMobile,
    isPhone,
    isQuickFilterActive,
    lensItems,
    logAnalysisActive,
    logAnalyticsQueryLimit,
    logAnalyticsStorage,
    logBrowserTimeZone,
    logDraftRange,
    logRangePreset,
    logHistoryEnabled,
    logHistoryError,
    logHourCycle,
    logQuery,
    logQueryStatus,
    logResultsTruncated,
    logTableColumns,
    logTimeFormatError,
    logTimeZone,
    logToolbar,
    managedMode,
    mobileQueryState,
    mobileSortKey,
    mobileStatusLabel,
    modeTransitioning,
    openSettings,
    protocols,
    receiver,
    refreshTemporaryAzureAccess,
    rememberConnectionString,
    resetActiveFilters,
    restoreDnsFocus,
    restoreSettingsFocus,
    runActiveLogAnalysis,
    runLogAnalysis,
    selectLog,
    selectMode,
    selectedLog,
    setLens,
    setSort,
    settingsOpen,
    showRealTimeLag,
    sortedLogs,
    sourceItems,
    statusTone,
    temporaryAccessError,
    temporaryAccessStatus,
    temporaryAdminConsentUrl,
    temporaryAzureUsername,
    temporaryLogAnalyticsAuth,
    temporaryLogAnalyticsAuthorizing,
    temporaryLogAnalyticsMode,
    temporaryTenantId,
    temporaryTenants,
    temporaryWorkspaceId,
    temporaryWorkspaces,
    toggleMobileSortDirection,
    togglePause,
    toggleQuickFilter,
    updateConnectionForm,
    updateDnsFilters,
    updateDnsSort,
    updateLogDraftRange,
    updateLogRetention,
    use12HourTime,
    useLocalTime,
  }
}
