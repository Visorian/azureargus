<script setup lang="ts">
import { createFirewallExportCommand } from '~/utils/firewallExportCommand'
import type { FirewallExportCommandOptions } from '~/utils/firewallExportCommand'

const options = reactive<FirewallExportCommandOptions>({
  subscription: '',
  resourceGroup: '',
  firewallName: '',
  policyName: '',
  output: 'file',
})
const command = computed(() => createFirewallExportCommand(options))
const commandInput = useTemplateRef('commandInput')
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
    title="Export Azure Firewall configuration"
    description="Read-only export of policies, their ancestors, collection groups and IP groups."
    :ui="{
      content: 'touch-fields max-w-3xl',
      header: 'shrink-0 pe-16',
      body: 'min-h-0 max-h-none space-y-5 overflow-y-auto',
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
      <div class="space-y-3">
        <p class="text-sm text-muted">
          All filters are optional. Blank names export all policies in the chosen scope, using your
          current Azure CLI subscription by default.
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
        <p class="text-xs text-muted">Provide either name, or both to combine their policies.</p>
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
      <div class="space-y-3">
        <p class="text-sm">
          Copy the entire command and run it in <strong>Nushell</strong> with Azure CLI installed.
          Sign in first with <code>az login</code>.
        </p>
        <UFormField name="export-command" label="Export command">
          <UTextarea
            id="export-command"
            ref="commandInput"
            :model-value="command"
            readonly
            :rows="8"
            class="w-full min-w-0"
            :ui="{ base: 'max-h-56 resize-none font-mono text-sm sm:text-xs' }"
            :spellcheck="false"
          />
        </UFormField>
        <p class="text-sm text-muted">
          {{
            options.output === 'file'
              ? 'When it finishes, upload firewall-configuration.json. An existing file with that name is preserved.'
              : 'When it finishes, copy the complete JSON output into Configuration text, then select Load configuration.'
          }}
        </p>
      </div>
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
          class="min-h-11"
          aria-live="polite"
          @click="copyCommand"
          >{{ copying ? 'Copying…' : copied ? 'Copied' : 'Copy command' }}</UButton
        >
      </div>
    </template>
  </UModal>
</template>
