<script setup lang="ts">
import type { FirewallSnapshot, SimulatorTraffic } from '#shared/types/firewallSimulator'
import { readAzureFirewallExport } from '#shared/utils/azureFirewallReader'
import { normalizeFirewallSnapshot, parseFirewallSnapshot } from '#shared/utils/firewallSimulator'
import {
  FIREWALL_SIMULATOR_EXAMPLE,
  FIREWALL_SIMULATOR_EXAMPLE_TRAFFIC,
} from '~/utils/firewallSimulatorExample'

const emit = defineEmits<{
  load: [snapshot: FirewallSnapshot, label: string, exampleTraffic?: SimulatorTraffic]
}>()
const RESOURCE_ID_LINES = /\r?\n/u
const mode = ref<'import' | 'azure'>('import')
const text = ref('')
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const importActions = useTemplateRef<HTMLDivElement>('importActions')
const resourceIds = ref('')
const tenantId = ref('')
const lastError = ref<string | null>(null)
const loading = ref(false)
const username = ref('')
const auth = useTemporaryLogAnalyticsAuth()
const runtimeConfig = useRuntimeConfig()
const liveAvailable = computed(() => Boolean(runtimeConfig.public.logAnalyticsDelegated.clientId))
const sourceError = computed(
  () => lastError.value ?? (mode.value === 'azure' ? auth.lastError.value : null),
)
let controller: AbortController | null = null
let generation = 0

function setMode(value: 'import' | 'azure') {
  lastError.value = null
  mode.value = value
}

async function focusImport(): Promise<void> {
  setMode('import')
  await nextTick()
  importActions.value
    ?.querySelector<HTMLButtonElement>('button[data-upload-configuration]')
    ?.focus()
}

defineExpose({ focusImport })

function cancelLoad() {
  generation += 1
  controller?.abort()
  controller = null
  loading.value = false
}
watch([mode, resourceIds, tenantId], cancelLoad)
onScopeDispose(cancelLoad)

function importText() {
  lastError.value = null
  try {
    emit('load', parseFirewallSnapshot(text.value), 'Pasted configuration')
  } catch (error: unknown) {
    lastError.value = error instanceof Error ? error.message : 'Could not read the configuration.'
  }
}

async function importFiles(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement) || !input.files?.length) {
    return
  }
  cancelLoad()
  const current = generation
  loading.value = true
  lastError.value = null
  const files = [...input.files]
  try {
    const content = (await Promise.all(files.map(async (file) => await file.text()))).join('\n')
    if (current !== generation) {
      return
    }
    const snapshot = parseFirewallSnapshot(content)
    text.value = content
    emit('load', snapshot, files.map((file) => file.name).join(', '))
  } catch (error: unknown) {
    if (current === generation) {
      lastError.value = error instanceof Error ? error.message : 'Could not read the files.'
    }
  } finally {
    if (current === generation) {
      loading.value = false
    }
    input.value = ''
  }
}

function loadExample() {
  cancelLoad()
  lastError.value = null
  text.value = ''
  emit(
    'load',
    normalizeFirewallSnapshot(FIREWALL_SIMULATOR_EXAMPLE),
    'Example configuration',
    FIREWALL_SIMULATOR_EXAMPLE_TRAFFIC,
  )
}

async function disconnectAzure() {
  cancelLoad()
  await auth.disconnect()
}

async function connectAzure() {
  cancelLoad()
  lastError.value = null
  const connection = await auth.connect()
  if (connection) {
    tenantId.value = connection.tenantId
    username.value = connection.username
  }
}

async function loadAzure() {
  cancelLoad()
  const current = generation
  const requestController = new AbortController()
  controller = requestController
  loading.value = true
  lastError.value = null
  try {
    const token = await auth.getManagementAccessToken(tenantId.value)
    const ids = resourceIds.value
      .split(RESOURCE_ID_LINES)
      .map((id) => id.trim())
      .filter(Boolean)
    const data = await readAzureFirewallExport(
      ids,
      token,
      AbortSignal.any([requestController.signal, AbortSignal.timeout(60_000)]),
    )
    if (current !== generation) {
      return
    }
    const snapshot = normalizeFirewallSnapshot(data)
    text.value = JSON.stringify(data, null, 2)
    emit('load', snapshot, `Azure · ${new Date().toLocaleString()}`)
  } catch (error: unknown) {
    if (current !== generation) {
      return
    }
    lastError.value = error instanceof Error ? error.message : 'Could not load Azure policies.'
  } finally {
    if (current === generation) {
      loading.value = false
      controller = null
    }
  }
}
</script>

<template>
  <div class="touch-fields min-w-0 space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <UFieldGroup
        role="group"
        aria-label="Configuration input"
        class="rounded-md border border-default bg-default"
      >
        <UButton
          :variant="mode === 'import' ? 'soft' : 'ghost'"
          color="neutral"
          :aria-pressed="mode === 'import'"
          class="min-h-11"
          @click="setMode('import')"
          >Paste or upload</UButton
        >
        <UButton
          :variant="mode === 'azure' ? 'soft' : 'ghost'"
          color="neutral"
          :aria-pressed="mode === 'azure'"
          class="min-h-11"
          @click="setMode('azure')"
          >Live Azure</UButton
        >
      </UFieldGroup>
      <UButton
        variant="ghost"
        color="neutral"
        icon="i-lucide-flask-conical"
        class="min-h-11"
        @click="loadExample"
        >Use example</UButton
      >
    </div>
    <div v-if="mode === 'import'" class="min-w-0 space-y-4">
      <div class="space-y-3">
        <p class="max-w-3xl text-sm text-muted">
          Upload a configuration snapshot, or get a command to export one from Azure Cloud Shell.
        </p>
        <div ref="importActions" class="grid gap-2 sm:flex sm:flex-wrap">
          <UButton
            icon="i-lucide-upload"
            color="primary"
            class="min-h-11 justify-center"
            data-upload-configuration
            :loading="loading"
            @click="fileInput?.click()"
            >Upload JSON files</UButton
          >
          <FirewallExportCommandModal />
          <input
            ref="fileInput"
            type="file"
            accept=".json,.jsonl,.txt,application/json,text/plain"
            multiple
            aria-label="Upload JSON files"
            class="hidden"
            :disabled="loading"
            @change="importFiles"
          />
        </div>
        <p class="max-w-3xl text-xs text-muted">
          JSON, JSONL or text files. Select several files together to include policies, collection
          groups and IP groups.
        </p>
      </div>
      <div class="space-y-3 border-t border-default pt-4">
        <UFormField
          label="Configuration text"
          name="firewall-configuration"
          help="You can also paste the complete export output here."
        >
          <UTextarea
            id="firewall-configuration"
            v-model="text"
            class="w-full min-w-0"
            :rows="4"
            placeholder="Paste Azure CLI or REST JSON"
            :spellcheck="false"
            :disabled="loading"
          />
        </UFormField>
        <UButton
          color="neutral"
          variant="outline"
          :disabled="!text.trim() || loading"
          class="min-h-11 disabled:opacity-50"
          @click="importText"
          >Load configuration</UButton
        >
      </div>
      <details class="text-sm text-muted">
        <summary
          class="min-h-11 cursor-pointer py-3 text-default focus-visible:outline-2 focus-visible:outline-primary"
        >
          What should the export contain?
        </summary>
        <p class="mt-1 max-w-3xl">
          Include each policy, its rule collection groups, and the referenced IP groups. A policy
          response alone contains references, not the rules. Include the base policy and each child
          you want to compare. You can combine separate JSON responses or use a
          <code>resources</code> array. ARM templates must contain resolved values.
        </p>
      </details>
    </div>
    <div v-else class="min-w-0 space-y-4">
      <p class="max-w-3xl text-sm text-muted">
        Read a snapshot of your policies, ancestors, rule collections and IP groups. Azure resources
        are not changed.
      </p>
      <div v-if="liveAvailable" class="flex flex-wrap items-center gap-3">
        <UButton
          :disabled="auth.status.value === 'connecting'"
          :loading="auth.status.value === 'connecting'"
          class="min-h-11"
          @click="connectAzure"
          >{{ auth.connected.value ? 'Switch Azure account' : 'Connect to Azure' }}</UButton
        >
        <span v-if="auth.connected.value" class="min-w-0 text-sm break-all text-muted">{{
          username
        }}</span>
        <UButton
          v-if="auth.connected.value"
          variant="ghost"
          color="neutral"
          class="min-h-11"
          @click="disconnectAzure"
          >Disconnect</UButton
        >
      </div>
      <div v-if="!liveAvailable" class="space-y-3 rounded-md border border-default p-4">
        <p class="font-medium">Azure browser sign-in is not configured for this deployment.</p>
        <p class="max-w-3xl text-sm text-muted">
          Use your signed-in Azure CLI to export the same configuration, then upload or paste it.
        </p>
        <div class="grid gap-2 sm:flex sm:flex-wrap">
          <FirewallExportCommandModal />
          <UButton color="neutral" variant="ghost" class="min-h-11" @click="focusImport"
            >Import configuration</UButton
          >
        </div>
      </div>
      <template v-else>
        <UFormField label="Tenant ID" name="firewall-tenant">
          <UInput
            id="firewall-tenant"
            v-model="tenantId"
            class="w-full max-w-lg"
            placeholder="Tenant containing the policies"
          />
        </UFormField>
        <UFormField
          label="Policy or firewall resource IDs"
          name="firewall-resource-ids"
          help="One full resource ID per line. Add several child policies to compare them; ancestors are included automatically."
        >
          <UTextarea
            id="firewall-resource-ids"
            v-model="resourceIds"
            class="w-full min-w-0"
            :rows="3"
            placeholder="/subscriptions/…/resourceGroups/…/providers/Microsoft.Network/firewallPolicies/…"
            :spellcheck="false"
          />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton
            :disabled="!auth.connected.value || !resourceIds.trim() || !tenantId.trim()"
            :loading="loading"
            class="min-h-11"
            @click="loadAzure"
            >Read Azure configuration</UButton
          >
          <UButton
            v-if="loading"
            color="neutral"
            variant="outline"
            class="min-h-11"
            @click="cancelLoad"
            >Cancel</UButton
          >
        </div>
        <p v-if="loading" role="status" class="text-sm text-muted">
          Reading policies, rule collections and IP groups…
        </p>
        <p class="max-w-3xl text-xs text-muted">
          Connect to Azure with an account that can read every selected policy, its ancestors, and
          the referenced IP groups, including those in other subscriptions.
        </p>
      </template>
    </div>
    <UAlert
      v-if="sourceError"
      color="error"
      variant="subtle"
      :title="sourceError"
      class="[overflow-wrap:anywhere]"
      role="alert"
    />
  </div>
</template>
