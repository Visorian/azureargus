<script setup lang="ts">
import { useEventListener } from '@vueuse/core'

const {
  options,
  command,
  nameErrors,
  instruction,
  copied,
  copying,
  copyError,
  copyFeedback,
  copyCommand,
} = useFirewallExportCommand()
const open = ref(false)
onDeactivated(() => {
  open.value = false
})
const commandInput = useTemplateRef('commandInput')
const copyFailure = useTemplateRef<{ $el: HTMLElement }>('copyFailure')
watch(copyError, async (error) => {
  if (error !== null) {
    await nextTick()
    copyFailure.value?.$el.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  }
})
useEventListener('resize', () => commandInput.value?.autoResize())
function selectCommand() {
  commandInput.value?.textareaRef?.focus()
  commandInput.value?.textareaRef?.select()
}
</script>

<template>
  <UModal
    v-model:open="open"
    title="Export Azure Firewall configuration"
    description="Read-only export of policies, their ancestors, collection groups and IP groups."
  >
    <UButton icon="i-lucide-terminal" variant="outline" color="neutral" class="justify-center"
      >Get export command</UButton
    >
    <template #body>
      <div class="space-y-5">
        <p class="sr-only" role="status">{{ copyFeedback }}</p>
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
            <UFormField name="export-firewall" label="Firewall name" :error="nameErrors.firewall">
              <UInput
                id="export-firewall"
                v-model="options.firewallName"
                class="w-full min-w-0"
                placeholder="e.g. hub-firewall"
              />
            </UFormField>
            <UFormField name="export-policy" label="Policy name" :error="nameErrors.policy">
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
          <AppSegmentedControl
            id="export-output"
            v-model="options.output"
            label="Output"
            :items="[
              { label: 'JSON file to upload', value: 'file' },
              { label: 'Text to paste', value: 'text' },
            ]"
          />
        </UFormField>
        <div v-if="command !== ''" class="space-y-3">
          <p class="text-sm">
            Run these lines together in the
            <strong>{{ options.environment === 'bash-cli' ? 'Bash' : 'PowerShell' }}</strong>
            session in Azure Cloud Shell. They download this version's Azure Argus export helper
            before running it. Cloud Shell is already authenticated.
          </p>
          <AppNotice
            v-if="copyError"
            ref="copyFailure"
            tone="error"
            title="Copy the command manually"
            :description="copyError"
          >
            <template #actions
              ><UButton color="neutral" variant="outline" @click="selectCommand"
                >Select command</UButton
              ></template
            >
          </AppNotice>
          <UFormField name="export-command" label="Export command">
            <UTextarea
              id="export-command"
              ref="commandInput"
              :model-value="command"
              readonly
              autoresize
              :rows="3"
              wrap="soft"
              class="simulator-identifiers w-full min-w-0"
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
        <p v-if="instruction" role="status" class="text-sm text-muted">{{ instruction }}</p>
      </div>
    </template>
    <template #footer="{ close }">
      <div class="export-modal-footer w-full items-center justify-between">
        <UButton color="neutral" variant="outline" @click="close">Close</UButton>
        <UButton
          class="export-copy-action"
          :aria-label="copied ? 'Copy command — Copied' : 'Copy command'"
          :icon="copying ? 'i-lucide-loader-circle' : copied ? 'i-lucide-check' : 'i-lucide-copy'"
          :aria-busy="copying"
          :aria-disabled="copying || command === ''"
          :disabled="command === ''"
          aria-live="polite"
          @click="copyCommand"
          >{{ copied ? 'Copied' : 'Copy command' }}</UButton
        >
      </div>
    </template>
  </UModal>
</template>
