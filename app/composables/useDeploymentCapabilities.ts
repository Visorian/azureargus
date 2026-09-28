import type { DeploymentCapabilities } from '#shared/types/deploymentCapabilities'

type CapabilityStatus = 'idle' | 'loading' | 'ready' | 'error'

let pendingLoad: Promise<DeploymentCapabilities> | null = null

export function useDeploymentCapabilities() {
  const capabilities = useState<DeploymentCapabilities | null>(
    'deployment-capabilities',
    () => null,
  )
  const status = useState<CapabilityStatus>('deployment-capabilities-status', () => 'idle')
  const lastError = useState<string | null>('deployment-capabilities-error', () => null)
  const requestFetch = useRequestFetch()

  async function load(force = false) {
    if (!force && capabilities.value !== null) {
      return capabilities.value
    }
    if (!force && pendingLoad !== null) {
      return await pendingLoad
    }

    status.value = 'loading'
    lastError.value = null
    const current = fetchCapabilities()
    pendingLoad = current
    try {
      return await current
    } finally {
      if (pendingLoad === current) {
        pendingLoad = null
      }
    }
  }

  async function fetchCapabilities() {
    try {
      const value = await requestFetch<DeploymentCapabilities>('/api/capabilities', {
        headers: { accept: 'application/json' },
      })
      capabilities.value = value
      status.value = 'ready'
      return value
    } catch (error: unknown) {
      capabilities.value = null
      status.value = 'error'
      lastError.value =
        error instanceof Error ? error.message : 'Deployment configuration is unavailable'
      throw error
    }
  }

  return {
    capabilities,
    lastError,
    load,
    status,
  }
}
