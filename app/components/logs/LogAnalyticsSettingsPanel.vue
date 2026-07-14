<script setup lang="ts">
import type { AzureAccessibleTenant, AzureAccessibleWorkspace } from "#shared/types/azureAccess";
import type { DnsReadinessSourceKind, DnsSourceReadiness } from "#shared/types/dns";
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

type ReadinessState =
  | "multiple-records"
  | "one-record"
  | "no-records"
  | "forbidden"
  | "failed"
  | "unchecked";

interface ReadinessItem {
  description: string;
  label: string;
  state: ReadinessState;
}

const readinessStyle: Record<ReadinessState, { icon: string; label: string; text: string }> = {
  "multiple-records": {
    icon: "i-lucide-circle-check",
    label: "2+ records",
    text: "text-green-700 dark:text-green-300",
  },
  "one-record": {
    icon: "i-lucide-circle-alert",
    label: "1 record",
    text: "text-amber-700 dark:text-amber-300",
  },
  "no-records": {
    icon: "i-lucide-circle-alert",
    label: "0 records",
    text: "text-amber-700 dark:text-amber-300",
  },
  forbidden: {
    icon: "i-lucide-circle-x",
    label: "Access denied",
    text: "text-red-700 dark:text-red-300",
  },
  failed: {
    icon: "i-lucide-circle-x",
    label: "Check failed",
    text: "text-red-700 dark:text-red-300",
  },
  unchecked: {
    icon: "i-lucide-circle-dashed",
    label: "Not checked",
    text: "text-brand-gray-500 dark:text-brand-gray-400",
  },
};

function sourceState(source: DnsReadinessSourceKind): ReadinessState {
  const readiness = props.dnsReadiness.find((item) => item.source === source);
  if (
    props.dnsReadinessStatus === "idle" ||
    props.dnsReadinessStatus === "loading" ||
    readiness === undefined
  ) {
    return "unchecked";
  }
  if (readiness.status !== "success") return readiness.status;
  if (readiness.sampleCount === 0) return "no-records";
  if (readiness.sampleCount === 1) return "one-record";
  return "multiple-records";
}

const readinessGroups = computed(() => [
  {
    label: "DNS sources",
    items: [
      {
        label: "Structured DNS proxy logs",
        description: "AZFWDnsQuery · any record in selected workspace",
        state: sourceState("proxy-structured"),
      },
      {
        label: "DNS flow trace logs",
        description: "AZFWDnsFlowTrace · any record in selected workspace",
        state: sourceState("dns-flow-trace"),
      },
      {
        label: "Internal FQDN resolution failures",
        description: "AZFWInternalFqdnResolutionFailure · any record in selected workspace",
        state: sourceState("internal-fqdn-failure"),
      },
      {
        label: "DNS transport logs",
        description: "AZFWNetworkRule · TCP or UDP port 53 record",
        state: sourceState("network-rule"),
      },
    ] satisfies ReadinessItem[],
  },
  {
    label: "Related firewall evidence",
    items: [
      {
        label: "Application rule evidence",
        description: "AZFWApplicationRule · FQDN-bearing record",
        state: sourceState("application-rule"),
      },
      {
        label: "TCP flow trace evidence",
        description: "AZFWFlowTrace · TCP port 53 record",
        state: sourceState("flow-trace"),
      },
      {
        label: "NAT rule evidence",
        description: "AZFWNatRule · original or translated port 53 record",
        state: sourceState("nat-rule"),
      },
    ] satisfies ReadinessItem[],
  },
]);
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
              tenantValid
                ? 'bg-brand-blue-50 text-brand-blue-700 dark:bg-brand-blue-950 dark:text-brand-blue-300'
                : 'bg-brand-gray-100 text-brand-gray-700 dark:bg-brand-gray-800 dark:text-brand-gray-200'
            "
          >
            2
          </span>
          <div class="min-w-0 space-y-3">
            <div>
              <p class="text-xs font-semibold">Choose Azure directory</p>
              <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                Directory IDs come from Azure access. Target tenant admin approves application once.
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
                :disabled="temporaryAccessStatus === 'loading' || workspaceItems.length === 0"
                :placeholder="
                  workspaceItems.length > 0
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
                :disabled="!tenantValid || temporaryAccessStatus === 'loading'"
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
                :disabled="!tenantValid"
              />
            </div>
            <p
              v-if="temporaryAccessStatus === 'success' && workspaceItems.length === 0"
              role="status"
              class="text-xs text-amber-700 dark:text-amber-300"
            >
              No accessible Log Analytics workspace found in selected directory.
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
            4
          </span>
          <div class="min-w-0 space-y-2">
            <div>
              <p class="text-xs font-semibold">Log Analytics query permission</p>
              <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                Cached permission is checked automatically after workspace selection. Grant
                permission only when interaction is required.
              </p>
            </div>
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-shield-check"
              :label="
                temporaryLogAnalyticsAuthorized
                  ? 'Log Analytics authorized'
                  : 'Grant query permission'
              "
              :loading="temporaryLogAnalyticsAuthorizing"
              :disabled="
                !workspaceValid ||
                temporaryLogAnalyticsAuthorizing ||
                temporaryLogAnalyticsAuthorized
              "
              @click="emit('authorizeLogAnalytics')"
            />
            <p
              v-if="temporaryLogAnalyticsAuthorized"
              role="status"
              class="text-xs text-green-700 dark:text-green-300"
            >
              Log Analytics query permission available for selected directory.
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
      v-if="lens === 'dns-troubleshooting'"
      aria-labelledby="dns-readiness-heading"
      class="rounded-md border border-brand-blue-300 bg-brand-blue-50/60 p-3 dark:border-brand-blue-800 dark:bg-brand-blue-950/30"
    >
      <div class="flex items-start gap-2">
        <UIcon
          name="i-lucide-info"
          class="mt-0.5 size-4 shrink-0 text-brand-blue-600 dark:text-brand-blue-300"
        />
        <div class="min-w-0 flex-1 space-y-3">
          <div>
            <h3 id="dns-readiness-heading" class="text-xs font-semibold">DNS source readiness</h3>
            <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
              Workspace-wide sample, independent of selected query range and filters. Updated after
              workspace selection changes.
            </p>
            <p
              v-if="dnsReadinessStatus === 'loading'"
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
              DNS source readiness check failed.
            </p>
          </div>
          <div v-for="group in readinessGroups" :key="group.label" class="space-y-2">
            <h4 class="text-xs font-semibold text-brand-gray-700 dark:text-brand-gray-200">
              {{ group.label }}
            </h4>
            <ul class="space-y-2">
              <li v-for="item in group.items" :key="item.label" class="flex items-start gap-2">
                <UIcon
                  :name="readinessStyle[item.state].icon"
                  :class="['mt-0.5 size-4 shrink-0', readinessStyle[item.state].text]"
                />
                <div class="min-w-0 flex-1">
                  <div class="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span class="text-xs font-medium">{{ item.label }}</span>
                    <span :class="['text-xs', readinessStyle[item.state].text]">
                      {{ readinessStyle[item.state].label }}
                    </span>
                  </div>
                  <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
                    {{ item.description }}
                  </p>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
