<script setup lang="ts">
import { useEventListener } from '@vueuse/core'

import {
  createFirewallExportCommand,
  firewallExportSelectionError,
  firewallExportSourceError,
} from '~/utils/firewallExportCommand'
import type { FirewallExportCommandOptions } from '~/utils/firewallExportCommand'

const options = reactive<FirewallExportCommandOptions>({
  environment: 'bash-cli',
  subscription: '',
  resourceGroup: '',
  firewallName: '',
  policyName: '',
  output: 'file',
})
const open = ref(false)
onDeactivated(() => {
  open.value = false
})
const appConfig = useAppConfig()
const command = computed(() => createFirewallExportCommand(options, appConfig.sourceRevision))
const commandError = computed(
  () =>
    firewallExportSourceError(appConfig.sourceRevision) ?? firewallExportSelectionError(options),
)
const commandInput = useTemplateRef('commandInput')
useEventListener('resize', () => commandInput.value?.autoResize())
const copying = ref(false)
const copied = ref(false)
const copyError = ref<string | null>(null)
watch(command, () => {
  copied.value = false
  copyError.value = null
})

function selectCommand() {
  commandInput.value?.textareaRef?.focus()
  commandInput.value?.textareaRef?.select()
}

async function copyCommand() {
  const requestedCommand = command.value
  copying.value = true
  copied.value = false
  copyError.value = null
  try {
    await navigator.clipboard.writeText(requestedCommand)
    copied.value = command.value === requestedCommand
  } catch {
    if (command.value === requestedCommand) {
      copyError.value = 'Clipboard access is unavailable. Select the command and copy it manually.'
    }
  } finally {
    copying.value = false
  }
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Export Azure Firewall configuration"
    description="Read-only export of policies, their ancestors, collection groups and IP groups."
    :ui="{
      content: 'touch-fields max-w-3xl',
      header: 'shrink-0 pe-16',
      body: 'relative min-h-0 max-h-none space-y-5 overflow-y-auto',
      footer: 'shrink-0 flex-col items-stretch gap-2 bg-default',
      close: 'top-2 end-2 min-h-11 min-w-11',
    }"
  >
    <UButton
      icon="i-lucide-terminal"
      variant="outline"
      color="neutral"
      class="min-h-11 justify-center"
      >Get export command</UButton
    >
    <template #body>
      <UFormField name="export-environment" label="Cloud Shell environment">
        <USelect
          id="export-environment"
          v-model="options.environment"
          :items="[
            { label: 'Azure CLI in Bash', value: 'bash-cli' },
            { label: 'Azure PowerShell', value: 'azure-powershell' },
            { label: 'Azure CLI in PowerShell', value: 'powershell-cli' },
          ]"
          class="w-full"
          :ui="{ base: 'min-h-11' }"
        />
      </UFormField>
      <div class="space-y-3">
        <p class="text-sm text-muted">
          Enter a firewall name, a policy name, or both. Subscription and resource group are
          optional.
        </p>
        <div class="grid gap-4 sm:grid-cols-2">
          <UFormField
            name="export-subscription"
            label="Subscription"
            help="Subscription name or ID."
          >
            <UInput
              id="export-subscription"
              v-model="options.subscription"
              class="w-full min-w-0"
              placeholder="Current subscription"
            />
          </UFormField>
          <UFormField
            name="export-resource-group"
            label="Resource group"
            help="Limits name lookup to this group."
          >
            <UInput
              id="export-resource-group"
              v-model="options.resourceGroup"
              class="w-full min-w-0"
              placeholder="All resource groups"
            />
          </UFormField>
          <UFormField name="export-firewall" label="Firewall name">
            <UInput
              id="export-firewall"
              v-model="options.firewallName"
              class="w-full min-w-0"
              placeholder="e.g. hub-firewall"
            />
          </UFormField>
          <UFormField name="export-policy" label="Policy name">
            <UInput
              id="export-policy"
              v-model="options.policyName"
              class="w-full min-w-0"
              placeholder="e.g. workload-policy"
            />
          </UFormField>
        </div>
        <p class="text-xs text-muted">
          A firewall includes its attached policy chain. A base policy also includes all child
          policies.
        </p>
      </div>
      <UFormField name="export-output" label="Output">
        <URadioGroup
          id="export-output"
          v-model="options.output"
          :items="[
            { label: 'JSON file to upload', value: 'file' },
            { label: 'Text to paste', value: 'text' },
          ]"
          orientation="horizontal"
          :ui="{
            fieldset: 'flex-wrap gap-x-6 gap-y-0',
            item: 'min-h-11 items-center',
            label: 'flex min-h-11 cursor-pointer items-center',
          }"
        />
      </UFormField>
      <div v-if="command !== ''" class="space-y-3">
        <p class="text-sm">
          Run these lines together in the
          <strong>{{ options.environment === 'bash-cli' ? 'Bash' : 'PowerShell' }}</strong>
          session in Azure Cloud Shell. They download this version's Azure Argus export helper
          before running it. Cloud Shell is already authenticated.
        </p>
        <UFormField name="export-command" label="Export command">
          <UTextarea
            id="export-command"
            ref="commandInput"
            :model-value="command"
            readonly
            autoresize
            :rows="3"
            wrap="soft"
            class="w-full min-w-0"
            :ui="{ base: 'resize-none font-mono text-sm sm:text-xs' }"
            :spellcheck="false"
          />
        </UFormField>
        <p class="text-sm text-muted">
          {{
            options.output === 'file'
              ? 'Download firewall-configuration.json from Cloud Shell, then upload it here. If that file already exists, the export stops. Rename or delete it before running the export again.'
              : 'When it finishes, copy the complete JSON output into Configuration text, then select Load configuration.'
          }}
        </p>
      </div>
      <p
        role="status"
        :class="
          commandError ? 'rounded-md border border-default p-3 text-sm text-muted' : 'sr-only'
        "
      >
        {{ commandError }}
      </p>
    </template>
    <template #footer="{ close }">
      <p v-if="copyError" role="alert" class="text-sm text-error">{{ copyError }}</p>
      <UButton
        v-if="copyError"
        color="neutral"
        variant="outline"
        class="min-h-11 justify-center"
        @click="selectCommand"
        >Select command</UButton
      >
      <div class="flex items-center justify-between gap-3">
        <UButton color="neutral" variant="outline" class="min-h-11" @click="close">Close</UButton>
        <UButton
          :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :loading="copying"
          :disabled="command === ''"
          class="min-h-11"
          aria-live="polite"
          @click="copyCommand"
          >{{ copying ? 'Copying…' : copied ? 'Copied' : 'Copy command' }}</UButton
        >
      </div>
    </template>
  </UModal>
</template>
