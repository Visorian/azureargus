import type { ComputedRef, Ref } from 'vue'

import {
  createFirewallExportCommand,
  firewallExportNameError,
  firewallExportSelectionError,
  firewallExportSourceError,
} from '~/utils/firewallExportCommand'
import type { FirewallExportCommandOptions } from '~/utils/firewallExportCommand'

interface FirewallExportCommandState {
  options: FirewallExportCommandOptions
  command: ComputedRef<string>
  nameErrors: ComputedRef<{ firewall: string | undefined; policy: string | undefined }>
  instruction: ComputedRef<string | undefined>
  copied: Ref<boolean>
  copying: Ref<boolean>
  copyFeedback: Readonly<Ref<string>>
  copyError: Ref<string | null>
  copyCommand: () => Promise<void>
}

export function useFirewallExportCommand(): FirewallExportCommandState {
  const options = reactive<FirewallExportCommandOptions>({
    environment: 'bash-cli',
    subscription: '',
    resourceGroup: '',
    firewallName: '',
    policyName: '',
    output: 'file',
  })
  const appConfig = useAppConfig()
  const command = computed(() => createFirewallExportCommand(options, appConfig.sourceRevision))
  const commandError = computed(
    () =>
      firewallExportSourceError(appConfig.sourceRevision) ?? firewallExportSelectionError(options),
  )

  const nameErrors = computed(() => ({
    firewall: firewallExportNameError(options.firewallName),
    policy: firewallExportNameError(options.policyName),
  }))
  const instruction = computed(() =>
    nameErrors.value.firewall !== undefined || nameErrors.value.policy !== undefined
      ? undefined
      : commandError.value,
  )
  const clipboard = useClipboardFeedback()
  const copied = ref(false)
  const copying = ref(false)
  const copyError = ref<string | null>(null)
  watch(command, () => {
    copied.value = false
    copyError.value = null
  })
  async function copyCommand() {
    if (!command.value || copying.value) {
      return
    }
    const requestedCommand = command.value
    copied.value = false
    copying.value = true
    copyError.value = null
    const succeeded = await clipboard.copy(requestedCommand, {
      success: false,
      error: false,
    })
    copied.value = succeeded && command.value === requestedCommand
    if (!succeeded && command.value === requestedCommand) {
      copyError.value = 'Clipboard access is unavailable. Select the command and copy it manually.'
    }
    copying.value = false
  }
  return {
    options,
    command,
    nameErrors,
    instruction,
    copied,
    copying,
    copyError,
    copyFeedback: clipboard.announcement,
    copyCommand,
  }
}
