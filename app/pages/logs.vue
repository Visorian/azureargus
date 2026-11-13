<script setup lang="ts">
definePageMeta({ layout: 'application' })
const {
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
} = useLogsWorkspace()
</script>

<template>
  <div class="logs-workspace flex h-full min-h-0 flex-col overflow-hidden">
    <section class="logs-context-row" aria-label="Workspace">
      <AppSegmentedControl
        :model-value="analysisMode"
        label="Data source"
        :items="sourceItems"
        @update:model-value="selectMode"
      />
      <AppSegmentedControl
        :model-value="activeLens"
        label="View"
        :items="lensItems"
        @update:model-value="setLens"
      />
      <UButton
        id="logs-settings-toggle"
        icon="i-lucide-settings"
        :label="isPhone ? undefined : 'Settings'"
        aria-label="Settings"
        aria-controls="logs-settings-drawer"
        :aria-expanded="settingsOpen"
        color="neutral"
        variant="outline"
        @click="openSettings"
      />
    </section>
    <LogsSettingsDrawer
      v-model:open="settingsOpen"
      v-model:use12-hour="use12HourTime"
      v-model:use-local="useLocalTime"
      :browser-time-zone="logBrowserTimeZone"
      :time-format-error="logTimeFormatError"
      @close-auto-focus="restoreSettingsFocus"
    >
      <LogsEventHubSettingsPanel
        v-if="!logAnalysisActive"
        v-model:remember-connection-string="rememberConnectionString"
        :connection-form="connectionForm"
        :clearing-log-history="clearingLogHistory"
        :connection-active="eventHubConnectionActive"
        :connecting="connecting"
        :connection-string-persistence-error="connectionStringPersistenceError"
        :log-history-enabled="logHistoryEnabled"
        :saved-log-count="receiver.receivedCount.value"
        :connection-error="receiver.errors.value.join(' ') || null"
        :log-history-error="logHistoryError"
        :managed="managedMode"
        :mode-transitioning="modeTransitioning"
        :reconnecting="receiver.status.value === 'reconnecting'"
        @update:connection-form="updateConnectionForm"
        @connect="connect"
        @disconnect="disconnectEventHub"
        @update-log-retention="updateLogRetention"
      />
      <div
        v-else
        @click.capture="commitLogAnalysisInteraction"
        @input.capture="commitLogAnalysisInteraction"
        @change.capture="commitLogAnalysisInteraction"
      >
        <LogsLogAnalyticsSettingsPanel
          v-model:query-storage="logAnalyticsStorage"
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
          @refresh-readiness="dnsSourceReadiness.refresh()"
        />
      </div>
    </LogsSettingsDrawer>
    <div
      class="logs-status-row"
      role="group"
      :aria-label="`${allLogsLensActive ? 'All logs' : 'DNS troubleshooting'} status and actions`"
    >
      <AppStatusLabel v-if="!isPhone" :tone="statusTone" :label="mobileStatusLabel" role="status" />
      <span v-if="!isPhone" class="text-xs text-muted">{{
        allLogsLensActive ? countLabel : dnsCountLabel
      }}</span>
      <span v-if="!isPhone && showRealTimeLag" class="logs-source-lag text-xs text-muted"
        ><UIcon name="i-lucide-clock-3" class="size-3.5" /><span>Latest</span
        ><NuxtTime
          :datetime="receiver.latestSourceTimestamp.value!"
          relative
          relative-style="narrow"
          numeric="always"
          :time-zone="logTimeZone"
          title
      /></span>
      <div class="ml-auto flex items-center gap-2">
        <UButton
          v-if="!isPhone && !logAnalysisActive && eventHubConnectionActive"
          :icon="receiver.status.value === 'paused' ? 'i-lucide-play' : 'i-lucide-pause'"
          :label="receiver.status.value === 'paused' ? 'Resume' : 'Pause'"
          color="neutral"
          variant="outline"
          @click="togglePause"
        />
        <UButton
          class="logs-clear"
          icon="i-lucide-trash-2"
          :label="
            dnsLensActive ? 'Clear DNS results' : logAnalysisActive ? 'Clear results' : 'Clear'
          "
          color="neutral"
          variant="ghost"
          :disabled="
            dnsLensActive
              ? dns.queriedEntryCount.value === 0 && dns.unidentifiedTransportCount.value === 0
              : sortedLogs.length === 0
          "
          @click="clearActiveResults"
        />
      </div>
    </div>
    <section
      v-if="allLogsLensActive"
      class="log-results-section flex min-h-0 flex-1 flex-col overflow-hidden"
      @click.capture="commitLogAnalysisInteraction"
      @input.capture="commitLogAnalysisInteraction"
      @change.capture="commitLogAnalysisInteraction"
    >
      <LogsLogAnalysisToolbar
        ref="logToolbar"
        :result-count="sortedLogs.length"
        :active-filter-count="activeFilterCount"
        :query-state="logAnalysisActive ? mobileQueryState : undefined"
        :applied-summary="appliedFilterSummary"
        @run="runActiveLogAnalysis"
        @interaction="commitLogAnalysisInteraction"
      >
        <template #compactSummary>
          <p
            v-for="(line, index) in appliedFilterSummary"
            :key="index"
            :class="index === 0 ? 'font-mono' : 'text-muted'"
          >
            {{ line }}
          </p>
          <span v-if="!logAnalysisActive" class="flex flex-wrap items-center gap-2"
            ><AppStatusLabel :label="mobileStatusLabel" :tone="statusTone" /><span
              v-if="showRealTimeLag"
              class="text-xs text-muted"
              >Latest ·
              <NuxtTime
                :datetime="receiver.latestSourceTimestamp.value!"
                relative
                relative-style="narrow"
                numeric="always"
                :time-zone="logTimeZone" /></span
            ><UButton
              v-if="eventHubConnectionActive"
              :icon="receiver.status.value === 'paused' ? 'i-lucide-play' : 'i-lucide-pause'"
              :aria-label="receiver.status.value === 'paused' ? 'Resume' : 'Pause'"
              color="neutral"
              variant="ghost"
              @click="togglePause"
          /></span>
        </template>
        <template #filters
          ><LogsLogConnectionFields
            v-model="activeFilters"
            :actions="actions"
            :protocols="protocols"
            :allow-create="logAnalysisActive"
            @create-action="logQuery.addActionOption"
            @create-protocol="logQuery.addProtocolOption"
        /></template>
        <template #search
          ><UFormField label="Search" class="min-w-0 flex-1"
            ><UInput
              v-model="activeFilters.search"
              icon="i-lucide-search"
              placeholder="Search logs"
              aria-label="Search logs"
              class="w-full" /></UFormField
          ><LogsLogCategoryFilter v-model="activeFilters.category" :categories="categories"
        /></template>
        <template #query
          ><LogsLogAnalyticsQueryControls
            v-if="logAnalysisActive"
            v-model:preset="logRangePreset"
            :draft-range="logDraftRange"
            @update:draft-range="updateLogDraftRange"
        /></template>
        <template #actions
          ><LogsLogFilterActions
            :reset-disabled="activeFilterCount === 0"
            @reset="resetActiveFilters"
        /></template>
        <template #summary>
          <div v-if="isMobile" class="connection-sort flex items-center justify-end gap-2">
            <USelect
              v-model="mobileSortKey"
              :items="logTableColumns"
              label-key="label"
              value-key="key"
              aria-label="Sort by"
            />
            <UButton
              :icon="activeSort.direction === 'desc' ? 'i-lucide-arrow-down' : 'i-lucide-arrow-up'"
              :aria-label="activeSort.direction === 'desc' ? 'Sort descending' : 'Sort ascending'"
              color="neutral"
              variant="ghost"
              @click="toggleMobileSortDirection"
            />
          </div>
        </template>
      </LogsLogAnalysisToolbar>
      <div
        class="logs-results flex min-h-0 flex-1 flex-col"
        :aria-busy="
          logAnalysisActive && (logQueryStatus === 'loading' || logQueryStatus === 'refreshing')
        "
      >
        <AppNotice
          v-if="logResultsTruncated && logAnalysisActive"
          tone="warning"
          title="Result incomplete"
          description="Result limit reached. Narrow filters or the time range for complete results."
        />
        <AppNotice
          v-if="!logAnalysisActive && receiver.errors.value.length"
          tone="error"
          title="Connection failed"
          :description="receiver.errors.value.join(' ')"
        />
        <LogsMobileLogList
          v-if="isMobile && sortedLogs.length"
          :logs="sortedLogs"
          :lookup="ipCountryLookup"
          :format-timestamp="formatLogTimestamp"
          :time-zone="logTimeZone"
          :hour-cycle="logHourCycle"
          @select="selectLog"
        />
        <LogsLogResultsTable
          v-else-if="sortedLogs.length"
          :logs="sortedLogs"
          :lookup="ipCountryLookup"
          :time-zone="logTimeZone"
          :hour-cycle="logHourCycle"
          :sort="activeSort"
          :active="isQuickFilterActive"
          @select="selectLog"
          @sort="setSort"
          @filter="toggleQuickFilter"
        />
        <div v-else class="logs-empty-state">
          <UIcon
            v-if="logQueryStatus === 'loading'"
            name="i-lucide-loader-circle"
            class="app-spinner size-6"
          />
          <h2 class="text-lg font-semibold">
            {{
              logAnalysisActive && logQueryStatus === 'loading'
                ? 'Loading logs'
                : logAnalysisActive && logQuery.lastError.value
                  ? 'Query failed'
                  : emptyState.title
            }}
          </h2>
          <p class="text-sm text-muted">
            {{
              logAnalysisActive && logQuery.lastError.value
                ? logQuery.lastError.value
                : logQueryStatus === 'loading' && logAnalysisActive
                  ? 'Querying your Log Analytics workspace…'
                  : emptyState.description
            }}
          </p>
          <UButton
            v-if="emptyState.settingsActionLabel"
            :label="emptyState.settingsActionLabel"
            color="neutral"
            variant="outline"
            @click="openSettings"
          />
          <UButton
            v-else-if="logAnalysisActive && logQuery.lastError.value"
            label="Retry query"
            color="neutral"
            variant="outline"
            @click="runLogAnalysis()"
          />
        </div>
      </div>
    </section>
    <section
      v-else
      class="log-results-section flex min-h-0 flex-1 flex-col overflow-hidden"
      @click.capture="commitLogAnalysisInteraction"
      @input.capture="commitLogAnalysisInteraction"
      @change.capture="commitLogAnalysisInteraction"
    >
      <LogsDnsTroubleshootingView
        ref="dnsView"
        v-model:show-unidentified-transports="dns.showUnidentifiedTransports.value"
        :hour-cycle="logHourCycle"
        :time-zone="logTimeZone"
        :filters="dns.filters.value"
        :sort="dns.sort.value"
        :entries="dns.entries.value"
        :sources="dns.sources.value"
        :status="dns.status.value"
        :error="dns.lastError.value"
        :entries-truncated="dns.entriesTruncated.value"
        :transports-truncated="dns.transportsTruncated.value"
        :log-analysis="logAnalysisActive"
        :live-connected="eventHubConnectionActive"
        :query-state="logAnalysisActive ? mobileQueryState : undefined"
        :filter-options="dns.filterOptions.value"
        :applied-filters="dns.appliedFilters.value"
        :applied-range="dns.appliedRange.value"
        @interaction="commitLogAnalysisInteraction"
        @run="runActiveLogAnalysis"
        @settings="openSettings"
        @update:filters="updateDnsFilters"
        @update:sort="updateDnsSort"
        @reset="dns.resetFilters"
        @select="dns.selectEntry"
      >
        <template v-if="logAnalysisActive" #queryControls>
          <LogsLogAnalyticsQueryControls
            v-model:preset="logRangePreset"
            :draft-range="logDraftRange"
            @update:draft-range="updateLogDraftRange"
          />
        </template>
      </LogsDnsTroubleshootingView>
    </section>
    <LogsLogDetailModal
      v-model:open="detailOpen"
      :record="selectedLog"
      :lookup="ipCountryLookup"
      :time-zone="logTimeZone"
      :format-timestamp="formatLogTimestamp"
      :live="!logAnalysisActive"
      @after-leave="clearClosedDetail"
    />
    <LogsDnsDetailModal
      v-model:open="dnsDetailOpen"
      :hour-cycle="logHourCycle"
      :time-zone="logTimeZone"
      :entry="dns.selectedEntry.value"
      :detail="dns.detail.value"
      :error="dns.detailError.value"
      :loading="dns.detailStatus.value === 'loading'"
      @close-auto-focus="restoreDnsFocus"
      @retry="dns.selectedEntry.value && dns.selectEntry(dns.selectedEntry.value)"
    />
  </div>
</template>
