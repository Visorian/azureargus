<script setup lang="ts">
import type { AzureAccessibleTenant, AzureAccessibleWorkspace } from "#shared/types/azureAccess";
import type { DnsReadinessSourceKind, DnsSourceReadiness } from "#shared/types/dns";
import type { LogAnalyticsStorageKind } from "#shared/types/logAnalytics";
import {
  DNS_READINESS_SOURCE_DEFINITIONS,
  hasDnsReadinessData,
  type DnsReadinessSourceGroup,
} from "#shared/utils/dnsReadiness";
import type { DnsReadinessStatus } from "~/composables/useDnsSourceReadiness";
import {
  MAX_LOG_ANALYTICS_QUERY_LIMIT,
  MIN_LOG_ANALYTICS_QUERY_LIMIT,
} from "#shared/utils/logAnalytics";
import { isEntraId, LOG_ANALYTICS_WORKSPACES_URL } from "~/utils/logAnalyticsOnboarding";

const props = defineProps<{
  adminConsentUrl: string | null;
  dnsReadiness: DnsSourceReadiness[];
  dnsReadinessStatus: DnsReadinessStatus;
  lens: "all-logs" | "dns-troubleshooting";
  temporary: boolean;
  temporaryAccessError: string | null;
  temporaryAccessStatus: "idle" | "loading" | "success" | "error";
  temporaryLogAnalyticsAuthorized: boolean;
  temporaryLogAnalyticsAuthorizing: boolean;
  temporaryAuthError: string | null;
  temporaryAuthStatus: "idle" | "connecting" | "connected" | "error";
  temporaryAzureUsername: string;
  tenantOptions: AzureAccessibleTenant[];
  workspaceOptions: AzureAccessibleWorkspace[];
}>();

const emit = defineEmits<{
  changeTenant: [tenantId: string];
  changeWorkspace: [workspaceId: string];
  connectAzure: [];
  disconnectAzure: [];
  authorizeLogAnalytics: [];
  refreshAzureAccess: [];
}>();

const tenantId = defineModel<string>("tenantId", { required: true });
const workspaceId = defineModel<string>("workspaceId", { required: true });
const queryLimit = defineModel<number>("queryLimit", { required: true });
const queryStorage = defineModel<LogAnalyticsStorageKind>("queryStorage", { required: true });
const tenantValid = computed(() => isEntraId(tenantId.value));
const workspaceValid = computed(() => isEntraId(workspaceId.value));
const tenantItems = computed(() =>
  props.tenantOptions.map((tenant) => ({
    ...tenant,
    label: tenant.defaultDomain
      ? `${tenant.displayName} · ${tenant.defaultDomain}`
      : tenant.displayName,
  })),
);
const workspaceItems = computed(() =>
  props.workspaceOptions.map((workspace) => ({
    ...workspace,
    label: `${workspace.name} · ${workspace.subscriptionName}`,
  })),
);
function changeTenant(value: unknown) {
  if (typeof value === "string" && value !== tenantId.value) {
    emit("changeTenant", value);
  }
}

function changeWorkspace(value: unknown) {
  if (typeof value === "string" && value !== workspaceId.value) {
    emit("changeWorkspace", value);
  }
}

type ReadinessIndicatorState =
  | "available"
  | "empty"
  | "missing"
  | "forbidden"
  | "failed"
  | "checking"
  | "unchecked";

interface ReadinessIndicator {
  label: string;
  state: ReadinessIndicatorState;
  statusLabel: string;
}

interface ReadinessItem {
  indicators: ReadinessIndicator[];
  label: string;
  mapping: string;
}

const readinessIndicatorStyle: Record<
  ReadinessIndicatorState,
  { icon: string; iconClass?: string; text: string }
> = {
  available: {
    icon: "i-lucide-circle-check",
    text: "text-green-700 dark:text-green-300",
  },
  empty: {
    icon: "i-lucide-circle-minus",
    text: "text-brand-gray-500 dark:text-brand-gray-400",
  },
  missing: {
    icon: "i-lucide-circle-minus",
    text: "text-brand-gray-500 dark:text-brand-gray-400",
  },
  forbidden: {
    icon: "i-lucide-lock-keyhole",
    text: "text-amber-700 dark:text-amber-300",
  },
  failed: {
    icon: "i-lucide-circle-x",
    text: "text-red-700 dark:text-red-300",
  },
  checking: {
    icon: "i-lucide-loader-circle",
    iconClass: "animate-spin",
    text: "text-brand-blue-600 dark:text-brand-blue-300",
  },
  unchecked: {
    icon: "i-lucide-circle-dashed",
    text: "text-brand-gray-400 dark:text-brand-gray-500",
  },
};

const readinessColumns = [
  { label: "Dedicated table", storage: "resource-specific" },
  { label: "AzureDiagnostics", storage: "azure-diagnostics" },
] as const satisfies readonly { label: string; storage: LogAnalyticsStorageKind }[];

function sourceIndicator(
  source: DnsReadinessSourceKind,
  storage: LogAnalyticsStorageKind,
  label: string,
): ReadinessIndicator {
  const readiness = props.dnsReadiness.find(
    (item) => item.source === source && item.storage === storage,
  );
  if (!readiness) {
    return props.dnsReadinessStatus === "loading"
      ? { label, state: "checking", statusLabel: "checking" }
      : { label, state: "unchecked", statusLabel: "not checked" };
  }
  if (readiness.status === "success") {
    if (storage === "azure-diagnostics" && readiness.sampleCount === 0) {
      return { label, state: "empty", statusLabel: "no matching records" };
    }
    return { label, state: "available", statusLabel: "available" };
  }
  if (readiness.status === "missing") {
    return { label, state: "missing", statusLabel: "not found" };
  }
  if (readiness.status === "forbidden") {
    return { label, state: "forbidden", statusLabel: "access denied" };
  }
  return { label, state: "failed", statusLabel: "check failed" };
}

function sourceIndicators(source: DnsReadinessSourceKind): ReadinessIndicator[] {
  return readinessColumns.map(({ label, storage }) => sourceIndicator(source, storage, label));
}

function readinessMapping(
  resourceSpecificTable: string,
  azureDiagnosticsCategory: string,
  queryScope?: string,
): string {
  const storageMapping =
    resourceSpecificTable === azureDiagnosticsCategory
      ? resourceSpecificTable
      : `${resourceSpecificTable} / ${azureDiagnosticsCategory}`;
  return queryScope ? `${storageMapping} · ${queryScope}` : storageMapping;
}

function readinessItem(
  friendlyLabel: string,
  source: DnsReadinessSourceKind,
  resourceSpecificTable: string,
  azureDiagnosticsCategory: string,
  queryScope?: string,
): ReadinessItem {
  return {
    label: friendlyLabel,
    mapping: readinessMapping(resourceSpecificTable, azureDiagnosticsCategory, queryScope),
    indicators: sourceIndicators(source),
  };
}

const readinessGroupLabels: Record<DnsReadinessSourceGroup, string> = {
  dns: "DNS sources",
  general: "General firewall logs",
};
const readinessGroups = computed(() =>
  (["dns", "general"] as const).map((group) => ({
    label: readinessGroupLabels[group],
    items: DNS_READINESS_SOURCE_DEFINITIONS.filter((definition) => definition.group === group).map(
      (definition) =>
        readinessItem(
          definition.friendlyLabel,
          definition.source,
          definition.resourceSpecificTable,
          definition.azureDiagnosticsCategory,
          "queryScope" in definition ? definition.queryScope : undefined,
        ),
    ),
  })),
);
const resourceSpecificAvailable = computed(() =>
  hasDnsReadinessData(props.dnsReadiness, "resource-specific"),
);
const azureDiagnosticsAvailable = computed(() =>
  hasDnsReadinessData(props.dnsReadiness, "azure-diagnostics"),
);
const queryStorageSelectionEnabled = computed(
  () => resourceSpecificAvailable.value && azureDiagnosticsAvailable.value,
);
const queryStorageItems: Array<{ label: string; value: LogAnalyticsStorageKind }> = [
  { label: "Dedicated tables", value: "resource-specific" },
  { label: "AzureDiagnostics", value: "azure-diagnostics" },
];
const readinessSourceCount = DNS_READINESS_SOURCE_DEFINITIONS.length;
const resourceSpecificReadyCount = computed(
  () =>
    props.dnsReadiness.filter(
      (item) => item.storage === "resource-specific" && item.status === "success",
    ).length,
);
const azureDiagnosticsReadyCount = computed(
  () =>
    props.dnsReadiness.filter(
      (item) =>
        item.storage === "azure-diagnostics" && item.status === "success" && item.sampleCount > 0,
    ).length,
);
</script>

<template>
  <div class="space-y-3">
    <div>
      <h2 class="text-sm font-semibold">Log Analytics settings</h2>
      <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
        {{
          lens === "dns-troubleshooting"
            ? "Query DNS diagnostics in configured Azure Firewall workspace."
            : "Query configured Azure Firewall workspace."
        }}
      </p>
    </div>

    <UFormField label="Query result limit" name="queryLimit">
      <UInputNumber
        v-model="queryLimit"
        :min="MIN_LOG_ANALYTICS_QUERY_LIMIT"
        :max="MAX_LOG_ANALYTICS_QUERY_LIMIT"
        :step="100"
        class="w-full"
      />
      <template #hint>100–5,000</template>
      <template #description>
        Caps All logs rows and each DNS result list. Applies to next query.
      </template>
    </UFormField>

    <div v-if="temporary" class="space-y-4">
      <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
        Sign in once. Azure directories and Log Analytics workspaces are discovered from account
        access.
      </p>
      <ol aria-label="Temporary Log Analytics setup" class="space-y-4">
        <li class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2">
          <span
            aria-hidden="true"
            class="grid size-6 place-items-center rounded-full bg-brand-blue-50 text-xs font-semibold text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300"
          >
            1
          </span>
          <div class="min-w-0 space-y-2">
            <div>
              <p class="text-xs font-semibold">Connect Azure account</p>
              <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                Work or school account determines available directories. Session stays in browser
                memory.
              </p>
            </div>
            <div class="flex flex-wrap gap-2">
              <UButton
                color="primary"
                variant="solid"
                icon="i-lucide-log-in"
                label="Connect to Azure"
                :loading="temporaryAuthStatus === 'connecting'"
                :disabled="
                  temporaryAuthStatus === 'connecting' || temporaryAuthStatus === 'connected'
                "
                @click="emit('connectAzure')"
              />
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-unplug"
                label="Disconnect"
                :disabled="temporaryAuthStatus !== 'connected'"
                @click="emit('disconnectAzure')"
              />
            </div>
            <p
              v-if="temporaryAuthStatus === 'connected'"
              role="status"
              class="text-xs text-green-700 dark:text-green-300"
            >
              Connected{{ temporaryAzureUsername ? ` as ${temporaryAzureUsername}` : "" }}.
            </p>
          </div>
        </li>
        <li
          v-if="temporaryAuthStatus === 'connected'"
          class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2"
        >
          <span
            aria-hidden="true"
            class="grid size-6 place-items-center rounded-full text-xs font-semibold"
            :class="
              temporaryLogAnalyticsAuthorized
                ? 'bg-brand-blue-50 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300'
                : 'bg-brand-gray-100 text-brand-gray-700 dark:bg-brand-gray-800 dark:text-brand-gray-200'
            "
          >
            2
          </span>
          <div class="min-w-0 space-y-3">
            <div>
              <p class="text-xs font-semibold">Choose Azure directory and grant consent</p>
              <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                Select target directory. Tenant admin must approve Log Analytics access before
                workspace selection.
              </p>
            </div>
            <UFormField label="Directory" name="tenantId">
              <USelectMenu
                :model-value="tenantId"
                :items="tenantItems"
                value-key="tenantId"
                label-key="label"
                class="w-full"
                :loading="temporaryAccessStatus === 'loading'"
                :disabled="temporaryAccessStatus === 'loading' || tenantItems.length === 0"
                placeholder="No Azure directory discovered"
                @update:model-value="changeTenant"
              />
            </UFormField>
            <p v-if="tenantValid" class="break-all font-mono text-[0.6875rem] text-brand-gray-500">
              {{ tenantId }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                :to="adminConsentUrl ?? undefined"
                target="_blank"
                rel="noopener noreferrer"
                color="neutral"
                variant="outline"
                icon="i-lucide-shield-check"
                label="Grant tenant consent"
                :disabled="adminConsentUrl === null"
              />
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-refresh-cw"
                label="Refresh consent"
                :loading="temporaryLogAnalyticsAuthorizing"
                :disabled="!tenantValid || temporaryLogAnalyticsAuthorizing"
                @click="emit('authorizeLogAnalytics')"
              />
            </div>
            <p
              v-if="temporaryLogAnalyticsAuthorized"
              role="status"
              class="text-xs text-green-700 dark:text-green-300"
            >
              Log Analytics access available for selected directory.
            </p>
          </div>
        </li>
        <li
          v-if="temporaryAuthStatus === 'connected'"
          class="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2"
        >
          <span
            aria-hidden="true"
            class="grid size-6 place-items-center rounded-full text-xs font-semibold"
            :class="
              workspaceValid
                ? 'bg-brand-blue-50 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300'
                : 'bg-brand-gray-100 text-brand-gray-700 dark:bg-brand-gray-800 dark:text-brand-gray-200'
            "
          >
            3
          </span>
          <div class="min-w-0 space-y-3">
            <div>
              <p class="text-xs font-semibold">Select accessible workspace</p>
              <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                Workspaces are resolved through Azure Resource Manager. Missing workspace requires
                Log Analytics Data Reader at workspace scope.
              </p>
            </div>
            <UFormField label="Workspace" name="workspaceId">
              <USelectMenu
                :model-value="workspaceId"
                :items="workspaceItems"
                value-key="workspaceId"
                label-key="label"
                class="w-full"
                :loading="temporaryAccessStatus === 'loading'"
                :disabled="
                  !temporaryLogAnalyticsAuthorized ||
                  temporaryAccessStatus === 'loading' ||
                  workspaceItems.length === 0
                "
                :placeholder="
                  !temporaryLogAnalyticsAuthorized
                    ? 'Grant tenant consent first'
                    : workspaceItems.length > 0
                      ? 'Select a workspace'
                      : 'No accessible workspace discovered'
                "
                @update:model-value="changeWorkspace"
              />
            </UFormField>
            <p
              v-if="workspaceValid"
              class="break-all font-mono text-[0.6875rem] text-brand-gray-500"
            >
              {{ workspaceId }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-refresh-cw"
                label="Refresh"
                :loading="temporaryAccessStatus === 'loading'"
                :disabled="
                  !tenantValid ||
                  !temporaryLogAnalyticsAuthorized ||
                  temporaryAccessStatus === 'loading'
                "
                @click="emit('refreshAzureAccess')"
              />
              <UButton
                :to="tenantValid ? LOG_ANALYTICS_WORKSPACES_URL : undefined"
                target="_blank"
                rel="noopener noreferrer"
                color="neutral"
                variant="outline"
                icon="i-lucide-external-link"
                label="Permissions"
                :disabled="!tenantValid || !temporaryLogAnalyticsAuthorized"
              />
            </div>
            <p
              v-if="
                temporaryLogAnalyticsAuthorized &&
                temporaryAccessStatus === 'success' &&
                workspaceItems.length === 0
              "
              role="status"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              No accessible Log Analytics workspace found in selected directory.
            </p>
            <p
              v-else-if="!temporaryLogAnalyticsAuthorized"
              role="status"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              Grant tenant consent before selecting a workspace.
            </p>
          </div>
        </li>
      </ol>
      <p v-if="temporaryAuthError" role="alert" class="text-xs text-red-600 dark:text-red-400">
        {{ temporaryAuthError }}
      </p>
      <p v-if="temporaryAccessError" role="alert" class="text-xs text-red-600 dark:text-red-400">
        {{ temporaryAccessError }}
      </p>
    </div>

    <section
      v-if="!temporary || workspaceValid"
      aria-labelledby="dns-readiness-heading"
      class="space-y-3 border-t border-brand-gray-200 pt-3 dark:border-brand-gray-800"
    >
      <div>
        <h3 id="dns-readiness-heading" class="text-xs font-semibold">Source readiness</h3>
        <p
          v-if="dnsReadinessStatus === 'success'"
          class="text-xs text-brand-gray-600 dark:text-brand-gray-300"
        >
          Dedicated tables {{ resourceSpecificReadyCount }}/{{ readinessSourceCount }} available ·
          AzureDiagnostics {{ azureDiagnosticsReadyCount }}/{{ readinessSourceCount }} with data.
        </p>
        <p
          v-else-if="dnsReadinessStatus === 'loading'"
          role="status"
          class="text-xs text-brand-blue-700 dark:text-brand-blue-300"
        >
          Checking selected workspace…
        </p>
        <p
          v-else-if="dnsReadinessStatus === 'error'"
          role="alert"
          class="text-xs text-red-700 dark:text-red-300"
        >
          Source readiness check failed.
        </p>
        <p v-else class="text-xs text-brand-gray-500 dark:text-brand-gray-400">
          Waiting for workspace check.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <label for="query-storage" class="shrink-0 text-xs font-semibold">Query source</label>
        <USelect
          id="query-storage"
          v-model="queryStorage"
          :items="queryStorageItems"
          :disabled="!queryStorageSelectionEnabled"
          aria-label="Query source"
          size="sm"
          class="min-w-0 flex-1"
        />
      </div>

      <table class="w-full table-fixed text-xs">
        <caption class="sr-only">
          Source availability in dedicated tables and AzureDiagnostics
        </caption>
        <colgroup>
          <col />
          <col class="w-14" />
          <col class="w-26" />
        </colgroup>
        <thead>
          <tr class="text-brand-gray-500 dark:text-brand-gray-400">
            <th scope="col" class="pb-1 text-left text-xs font-medium">Source</th>
            <th scope="col" class="pb-1 text-center text-xs font-medium">Table</th>
            <th scope="col" class="pb-1 text-center text-xs font-medium">AzureDiagnostics</th>
          </tr>
        </thead>
        <tbody v-for="group in readinessGroups" :key="group.label">
          <tr>
            <th
              scope="rowgroup"
              colspan="3"
              class="pb-1 pt-2 text-xs font-semibold text-brand-gray-600 dark:text-brand-gray-300"
            >
              <span class="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  class="h-px flex-1 bg-brand-gray-200 dark:bg-brand-gray-800"
                />
                <span>{{ group.label }}</span>
                <span
                  aria-hidden="true"
                  class="h-px flex-1 bg-brand-gray-200 dark:bg-brand-gray-800"
                />
              </span>
            </th>
          </tr>
          <tr v-for="item in group.items" :key="item.label">
            <th scope="row" class="py-1.5 pr-2 text-left align-top font-medium">
              <span class="block leading-4">{{ item.label }}</span>
              <span
                class="block break-words font-mono text-[0.6875rem] leading-4 font-normal text-brand-gray-500 dark:text-brand-gray-400"
              >
                {{ item.mapping }}
              </span>
            </th>
            <td
              v-for="indicator in item.indicators"
              :key="indicator.label"
              class="py-1.5 text-center align-top"
            >
              <span
                role="img"
                :aria-label="`${indicator.label}: ${indicator.statusLabel}`"
                :title="`${indicator.label}: ${indicator.statusLabel}`"
                :class="[
                  'inline-flex size-5 items-center justify-center',
                  readinessIndicatorStyle[indicator.state].text,
                ]"
              >
                <UIcon
                  :name="readinessIndicatorStyle[indicator.state].icon"
                  aria-hidden="true"
                  :class="['size-3.5', readinessIndicatorStyle[indicator.state].iconClass]"
                />
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
