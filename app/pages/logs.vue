<script setup lang="ts">
import { RecycleScroller } from "vue-virtual-scroller";

import visorianNegative from "~/assets/img/visorian-negative.svg";
import visorianPositive from "~/assets/img/visorian-positive.svg";
import type { EventHubConnectionForm } from "~/composables/useEventHubConnection";
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

const logTableColumns: LogTableColumn[] = [
  { key: "timestamp", label: "Date" },
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
const connecting = ref(false);
const sidebarCollapsed = ref(false);
const detailOpen = ref(false);
const selectedLog = ref<FirewallLogRecord | null>(null);
const toast = useToast();
const { filters, filteredLogs, resetFilters } = useLogQuery(receiver.logs, receiver.visibleLimit);
const { sortedLogs, setSort, getSortIcon, getAriaSort } = useLogSorting(filteredLogs);
const actionLabels: Record<string, string> = {
  allow: "Allow",
  deny: "Deny",
  dnat: "DNAT",
  snat: "SNAT",
};

const categories = computed(() => {
  return [...new Set(receiver.logs.value.map((log) => log.category).filter(Boolean))].sort();
});
const actions = computed(() => {
  return createCaseInsensitiveFilterOptions(
    receiver.logs.value.map((log) => log.action),
    (value) => actionLabels[value.toLowerCase()] ?? value,
  );
});
const protocols = computed(() => {
  return createCaseInsensitiveFilterOptions(
    receiver.logs.value.map((log) => log.protocol),
    (value) => value.toUpperCase(),
  );
});
const parsedDetailFields = computed<DetailField[]>(() => {
  const log = selectedLog.value;
  if (log === null) {
    return [];
  }

  return [
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
    { label: "Partition", value: log.partitionId, mono: true },
    { label: "Sequence", value: log.sequenceNumber, mono: true },
    {
      label: "Enqueued",
      value: log.enqueuedTimeUtc ? formatTime(log.enqueuedTimeUtc) : undefined,
      mono: true,
    },
  ];
});
const rawLogJson = computed(() => {
  if (selectedLog.value === null) {
    return "";
  }

  return JSON.stringify(selectedLog.value.raw, null, 2);
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

async function connect() {
  connecting.value = true;
  try {
    await receiver.connect(connectionForm);
  } finally {
    connecting.value = false;
  }
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
  if (status === "connected") {
    return "success";
  }
  if (status === "paused") {
    return "warning";
  }
  if (status === "error") {
    return "error";
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
        : 'grid-cols-1 grid-rows-[auto_1fr] lg:grid-cols-[23rem_1fr] lg:grid-rows-1',
    ]"
  >
    <UButton
      v-if="sidebarCollapsed"
      icon="i-lucide-panel-left-open"
      aria-label="Expand sidebar"
      color="neutral"
      variant="outline"
      square
      size="xs"
      class="absolute top-1/2 left-0 z-20 -translate-y-1/2 rounded-l-none border-l-0 bg-white dark:bg-brand-gray-950"
      @click="expandSidebar"
    />

    <aside
      v-show="!sidebarCollapsed"
      class="relative flex max-h-80 min-h-0 flex-col border-b border-brand-gray-300 bg-white dark:border-brand-gray-700 dark:bg-brand-gray-950 lg:max-h-none lg:border-b-0 lg:border-r"
    >
      <UButton
        icon="i-lucide-panel-left-close"
        aria-label="Collapse sidebar"
        color="neutral"
        variant="outline"
        square
        size="xs"
        class="absolute top-1/2 right-0 z-20 translate-x-1/2 -translate-y-1/2 rounded-full bg-white dark:bg-brand-gray-950"
        @click="collapseSidebar"
      />

      <section class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div>
          <h2 class="text-sm font-semibold">Event Hub connection</h2>
          <p class="text-xs text-brand-gray-600 dark:text-brand-gray-300">
            Use a Listen-only SAS policy. Values stay in memory.
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
          <UFormField label="Lookback minutes" name="lookbackMinutes">
            <UInput
              v-model.number="connectionForm.lookbackMinutes"
              type="number"
              min="0"
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

    <section class="flex min-h-0 flex-col overflow-hidden bg-brand-gray-50 dark:bg-brand-gray-950">
      <div
        class="shrink-0 border-b border-brand-gray-300 bg-white p-4 dark:border-brand-gray-700 dark:bg-brand-gray-950"
      >
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <UBadge :color="statusColor(receiver.status.value)" variant="subtle">
              {{ receiver.status.value }}
            </UBadge>
            <span class="text-sm text-brand-gray-600 dark:text-brand-gray-300">
              {{ sortedLogs.length }} visible / {{ receiver.receivedCount.value }} received
            </span>
          </div>
          <div class="flex gap-2">
            <UButton
              v-if="receiver.status.value === 'connected'"
              variant="outline"
              color="neutral"
              icon="i-lucide-pause"
              label="Pause"
              @click="receiver.pause"
            />
            <UButton
              v-if="receiver.status.value === 'paused'"
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
              label="Clear"
              @click="receiver.clear"
            />
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <UInput
            v-model="filters.search"
            icon="i-lucide-search"
            placeholder="Search logs"
            class="min-w-48 flex-1"
          />
          <USelectMenu
            v-model="filters.category"
            :items="categories"
            placeholder="Category"
            class="w-38"
          />
          <USelectMenu
            v-model="filters.action"
            :items="actions"
            placeholder="Action"
            class="w-34"
          />
          <USelectMenu
            v-model="filters.protocol"
            :items="protocols"
            placeholder="Protocol"
            class="w-34"
          />
          <UInput v-model="filters.source" placeholder="Source" class="w-40" />
          <UInput v-model="filters.destination" placeholder="Destination" class="w-40" />
          <UInput
            v-model="filters.from"
            type="datetime-local"
            aria-label="From timestamp"
            class="w-48"
          />
          <UInput
            v-model="filters.to"
            type="datetime-local"
            aria-label="To timestamp"
            class="w-48"
          />
          <UButton
            variant="ghost"
            color="neutral"
            icon="i-lucide-rotate-ccw"
            label="Reset"
            @click="resetFilters"
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
              <button
                type="button"
                role="row"
                :title="rowTitle(item)"
                :class="[
                  'grid h-16 w-full items-center border-b border-brand-gray-200 bg-white text-left text-sm text-brand-gray-950 hover:bg-brand-blue-50 focus-visible:outline-2 focus-visible:outline-brand-blue-500 dark:border-brand-gray-700 dark:bg-brand-gray-950 dark:text-brand-gray-50 dark:hover:bg-brand-gray-900',
                  logTableGridClass,
                ]"
                @click="selectLog(item)"
              >
                <span class="px-2 font-mono text-xs text-brand-gray-700 dark:text-brand-gray-200">
                  {{ formatTime(item.timestamp) }}
                </span>
                <span class="truncate px-2">{{ displayValue(item.category) }}</span>
                <span class="truncate px-2 font-medium">{{ displayValue(item.action) }}</span>
                <span class="truncate px-2">{{ displayValue(item.protocol) }}</span>
                <span class="truncate px-2">{{ displayValue(item.sourceIp) }}</span>
                <span class="truncate px-2 font-mono text-xs">{{
                  displayValue(item.sourcePort)
                }}</span>
                <span class="truncate px-2">{{ displayValue(item.destinationIp) }}</span>
                <span class="truncate px-2 font-mono text-xs">
                  {{ displayValue(item.destinationPort) }}
                </span>
                <span class="truncate px-2">{{ displayValue(item.rule) }}</span>
              </button>
            </RecycleScroller>
            <div v-else class="grid min-h-0 flex-1 place-items-center p-8 text-center">
              <div class="max-w-sm space-y-2">
                <UIcon name="i-lucide-list-filter" class="mx-auto size-8 text-brand-gray-400" />
                <h2 class="text-sm font-semibold">No logs received</h2>
                <p class="text-sm text-brand-gray-600 dark:text-brand-gray-300">
                  Connect to an Event Hub with a Listen-only SAS connection string.
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
