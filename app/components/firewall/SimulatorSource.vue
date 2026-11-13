<script setup lang="ts">
import type { FirewallSnapshot, SimulatorTraffic } from '#shared/types/firewallSimulator'

defineProps<{ hasConfiguration?: boolean }>()
const emit = defineEmits<{
  load: [snapshot: FirewallSnapshot, label: string, exampleTraffic?: SimulatorTraffic]
}>()
const {
  mode,
  text,
  resourceIds,
  tenantId,
  loading,
  username,
  auth,
  liveAvailable,
  sourceError,
  pasteError,
  uploadError,
  canRead,
  cancelLoad,
  importText,
  importFiles,
  loadExample,
  disconnectAzure,
  connectAzure,
  loadAzure,
} = useSimulatorSource((...args) => emit('load', ...args))
const configurationInput = useTemplateRef('configurationInput')
async function loadText() {
  importText()
  if (pasteError.value) {
    await nextTick()
    configurationInput.value?.textareaRef?.focus()
  }
}
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
const uploadButton = useTemplateRef<{ $el: HTMLButtonElement }>('uploadButton')
const readButton = useTemplateRef<{ $el: HTMLButtonElement }>('readButton')
const connectButton = useTemplateRef<{ $el: HTMLButtonElement }>('connectButton')
const inputModes = [
  { value: 'import', label: 'Paste or upload' },
  { value: 'azure', label: 'Live Azure' },
] as const

async function focusImport(): Promise<void> {
  cancelLoad()
  mode.value = 'import'
  await nextTick()
  uploadButton.value?.$el.focus()
}
async function handleFiles(event: Event) {
  const input = event.target
  if (!(input instanceof HTMLInputElement)) {
    return
  }
  await importFiles([...(input.files ?? [])])
  input.value = ''
}
async function cancelRead() {
  cancelLoad()
  await nextTick()
  readButton.value?.$el.focus()
}
async function disconnect() {
  await disconnectAzure()
  await nextTick()
  connectButton.value?.$el.focus()
}

defineExpose({ focusImport })
</script>

<template>
  <div class="touch-fields min-w-0 space-y-5">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <AppSegmentedControl v-model="mode" :items="inputModes" label="Configuration input" />
      <UButton variant="ghost" color="neutral" icon="i-lucide-flask-conical" @click="loadExample"
        >Use example</UButton
      >
    </div>
    <div v-if="mode === 'import'" class="min-w-0 space-y-4">
      <div class="space-y-3">
        <p class="max-w-3xl text-sm text-muted">
          Upload a configuration snapshot, or get a command to export one from Azure Cloud Shell.
        </p>
        <div class="grid gap-2 sm:flex sm:flex-wrap">
          <UButton
            ref="uploadButton"
            :icon="loading ? 'i-lucide-loader-circle' : 'i-lucide-upload'"
            :color="hasConfiguration ? 'neutral' : 'primary'"
            :variant="hasConfiguration ? 'outline' : 'solid'"
            class="justify-center"
            data-upload-configuration
            :aria-busy="loading"
            :aria-disabled="loading"
            @click="!loading && fileInput?.click()"
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
            @change="handleFiles"
          />
        </div>
        <AppNotice
          v-if="uploadError"
          tone="error"
          title="Could not read configuration files"
          :description="uploadError"
        />
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
          :error="pasteError || undefined"
        >
          <UTextarea
            id="firewall-configuration"
            ref="configurationInput"
            v-model="text"
            class="simulator-identifiers w-full min-w-0"
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
          @click="loadText"
          >Load configuration</UButton
        >
      </div>
      <AppDisclosure title="What should the export contain?">
        <p class="mt-1 max-w-3xl">
          Include each policy, its rule collection groups, and the referenced IP groups. A policy
          response alone contains references, not the rules. Include the base policy and each child
          you want to compare. You can combine separate JSON responses or use a
          <code>resources</code> array. ARM templates must contain resolved values.
        </p>
      </AppDisclosure>
    </div>
    <div v-else class="min-w-0 space-y-4">
      <p class="max-w-3xl text-sm text-muted">
        Read a snapshot of your policies, ancestors, rule collections and IP groups. Azure resources
        are not changed.
      </p>
      <div v-if="liveAvailable" class="flex flex-wrap items-center gap-3">
        <UButton
          ref="connectButton"
          :icon="auth.status.value === 'connecting' ? 'i-lucide-loader-circle' : 'i-lucide-log-in'"
          :color="!hasConfiguration && !auth.connected.value ? 'primary' : 'neutral'"
          :variant="!hasConfiguration && !auth.connected.value ? 'solid' : 'outline'"
          :aria-disabled="auth.status.value === 'connecting'"
          :aria-busy="auth.status.value === 'connecting'"
          @click="connectAzure"
          >{{ auth.connected.value ? 'Switch Azure account' : 'Connect to Azure' }}</UButton
        >
        <span v-if="auth.connected.value" class="min-w-0 text-sm break-all text-muted">{{
          username
        }}</span>
        <UButton v-if="auth.connected.value" variant="ghost" color="neutral" @click="disconnect"
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
          <UButton color="neutral" variant="ghost" @click="focusImport"
            >Import configuration</UButton
          >
        </div>
      </div>
      <template v-else>
        <UFormField label="Tenant ID" name="firewall-tenant">
          <UInput
            id="firewall-tenant"
            v-model="tenantId"
            class="simulator-identifiers w-full max-w-lg"
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
            class="simulator-identifiers w-full min-w-0"
            :rows="3"
            placeholder="/subscriptions/…/resourceGroups/…/providers/Microsoft.Network/firewallPolicies/…"
            :spellcheck="false"
          />
        </UFormField>
        <div class="flex flex-wrap gap-2">
          <UButton
            ref="readButton"
            :icon="loading ? 'i-lucide-loader-circle' : 'i-lucide-download'"
            :color="!hasConfiguration && canRead ? 'primary' : 'neutral'"
            :variant="!hasConfiguration && canRead ? 'solid' : 'outline'"
            :disabled="!canRead && !loading"
            :aria-disabled="loading || !canRead"
            :aria-busy="loading"
            @click="loadAzure"
            >Read Azure configuration</UButton
          >
          <UButton v-if="loading" color="neutral" variant="outline" @click="cancelRead"
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
    <AppNotice
      v-if="mode === 'azure' && sourceError"
      tone="error"
      title="Azure request failed"
      :description="sourceError"
      class="[overflow-wrap:anywhere]"
      role="alert"
    />
  </div>
</template>
