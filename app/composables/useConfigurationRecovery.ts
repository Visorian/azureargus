import type { ComputedRef, Ref } from 'vue'

import type { DeploymentCapabilities } from '#shared/types/deploymentCapabilities'

export function useConfigurationRecovery(): {
  checking: ComputedRef<boolean>
  errors: Ref<DeploymentCapabilities['errors']>
  feedback: Ref<string | null>
  retrying: Ref<boolean>
  unavailable: ComputedRef<boolean>
  retry: () => Promise<void>
} {
  const deployment = useDeploymentCapabilities()
  const retrying = ref(false)
  const feedback = ref<string | null>(null)
  const phase = ref<'checking' | 'invalid' | 'error' | 'ready'>('checking')
  if (deployment.capabilities.value?.mode === 'invalid') {
    phase.value = 'invalid'
  } else if (deployment.status.value === 'error') {
    phase.value = 'error'
  }
  const checking = computed(() => phase.value === 'checking')
  const unavailable = computed(() => phase.value === 'invalid' || phase.value === 'error')
  const errors = ref(deployment.capabilities.value?.errors ?? [])

  async function check(force = false): Promise<void> {
    if (retrying.value) {
      return
    }
    retrying.value = true
    feedback.value = null
    try {
      const capabilities = await deployment.load(force)
      if (capabilities.mode === 'invalid') {
        errors.value = capabilities.errors
        phase.value = 'invalid'
        if (force) {
          feedback.value =
            'Configuration is still unavailable. Check the deployment settings and retry.'
        }
      } else {
        phase.value = 'ready'
        await navigateTo(capabilities.mode === 'anonymous' ? '/logs' : '/login')
      }
    } catch {
      phase.value = 'error'
      if (force) {
        feedback.value = 'Configuration is still unavailable. Check the connection and retry.'
      }
    } finally {
      retrying.value = false
    }
  }

  onMounted(() => {
    if (checking.value) {
      void check()
    }
  })

  async function retry(): Promise<void> {
    if (!unavailable.value) {
      return
    }
    await check(true)
  }

  return { checking, errors, feedback, retrying, unavailable, retry }
}
