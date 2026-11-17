import type { ComputedRef } from 'vue'

export interface UseAnonymousModeReturn {
  enabled: ComputedRef<boolean>
}

export function useAnonymousMode(): UseAnonymousModeReturn {
  const deployment = useDeploymentCapabilities()
  const enabled = computed(() => deployment.capabilities.value?.mode === 'anonymous')

  return {
    enabled,
  }
}
