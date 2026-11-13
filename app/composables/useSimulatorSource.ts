import type { ComputedRef, Ref } from 'vue'

import type { FirewallSnapshot, SimulatorTraffic } from '#shared/types/firewallSimulator'
import { readAzureFirewallExport } from '#shared/utils/azureFirewallReader'
import { normalizeFirewallSnapshot, parseFirewallSnapshot } from '#shared/utils/firewallSimulator'
import {
  FIREWALL_SIMULATOR_EXAMPLE,
  FIREWALL_SIMULATOR_EXAMPLE_TRAFFIC,
} from '~/utils/firewallSimulatorExample'

const RESOURCE_ID_LINES = /\r?\n/u

interface SimulatorSourceState {
  mode: Ref<'import' | 'azure'>
  text: Ref<string>
  resourceIds: Ref<string>
  tenantId: Ref<string>
  loading: Ref<boolean>
  username: Ref<string>
  auth: ReturnType<typeof useTemporaryLogAnalyticsAuth>
  liveAvailable: ComputedRef<boolean>
  sourceError: ComputedRef<string | null>
  pasteError: ComputedRef<string | null>
  uploadError: ComputedRef<string | null>
  canRead: ComputedRef<boolean>
  cancelLoad: () => void
  importText: () => void
  importFiles: (files: readonly File[]) => Promise<void>
  loadExample: () => void
  disconnectAzure: () => Promise<void>
  connectAzure: () => Promise<void>
  loadAzure: () => Promise<void>
}

export function useSimulatorSource(
  onLoad: (snapshot: FirewallSnapshot, label: string, exampleTraffic?: SimulatorTraffic) => void,
): SimulatorSourceState {
  const mode = ref<'import' | 'azure'>('import')
  const text = ref('')
  const resourceIds = ref('')
  const tenantId = ref('')
  const lastError = ref<string | null>(null)
  const errorSource = ref<'paste' | 'upload' | 'azure' | null>(null)
  const loading = ref(false)
  const username = ref('')
  const auth = useTemporaryLogAnalyticsAuth()
  const runtimeConfig = useRuntimeConfig()
  const liveAvailable = computed(() => Boolean(runtimeConfig.public.logAnalyticsDelegated.clientId))
  const sourceError = computed(
    () => lastError.value ?? (mode.value === 'azure' ? auth.lastError.value : null),
  )
  const pasteError = computed(() => (errorSource.value === 'paste' ? lastError.value : null))
  const uploadError = computed(() => (errorSource.value === 'upload' ? lastError.value : null))
  const canRead = computed(
    () =>
      auth.connected.value &&
      auth.status.value !== 'connecting' &&
      tenantId.value.trim().length > 0 &&
      resourceIds.value.trim().length > 0,
  )
  let controller: AbortController | null = null
  let generation = 0

  function cancelLoad() {
    generation += 1
    controller?.abort()
    controller = null
    loading.value = false
  }
  watch([mode, resourceIds, tenantId], cancelLoad)
  watch(mode, () => {
    lastError.value = null
    errorSource.value = null
  })
  watch(text, () => {
    if (errorSource.value === 'paste') {
      lastError.value = null
      errorSource.value = null
    }
  })
  onScopeDispose(cancelLoad)
  onDeactivated(cancelLoad)

  function importText() {
    if (loading.value) {
      return
    }
    lastError.value = null
    errorSource.value = 'paste'
    try {
      onLoad(
        parseFirewallSnapshot(text.value),
        `Pasted configuration · ${new Date().toLocaleString()}`,
      )
    } catch (error: unknown) {
      lastError.value = error instanceof Error ? error.message : 'Could not read the configuration.'
    }
  }

  async function importFiles(files: readonly File[]) {
    if (files.length === 0) {
      return
    }
    cancelLoad()
    const current = generation
    loading.value = true
    lastError.value = null
    errorSource.value = 'upload'
    try {
      const content = (await Promise.all(files.map(async (file) => await file.text()))).join('\n')
      if (current !== generation) {
        return
      }
      const snapshot = parseFirewallSnapshot(content)
      text.value = content
      onLoad(
        snapshot,
        `${files.map((file) => file.name).join(', ')} · ${new Date().toLocaleString()}`,
      )
    } catch (error: unknown) {
      if (current === generation) {
        lastError.value = error instanceof Error ? error.message : 'Could not read the files.'
      }
    } finally {
      if (current === generation) {
        loading.value = false
      }
    }
  }

  function loadExample() {
    cancelLoad()
    lastError.value = null
    errorSource.value = null
    text.value = ''
    onLoad(
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
    if (auth.status.value === 'connecting') {
      return
    }
    cancelLoad()
    lastError.value = null
    const connection = await auth.connect()
    if (connection) {
      tenantId.value = connection.tenantId
      username.value = connection.username
    }
  }

  async function loadAzure() {
    if (loading.value || !canRead.value) {
      return
    }
    cancelLoad()
    const current = generation
    const requestController = new AbortController()
    controller = requestController
    loading.value = true
    lastError.value = null
    errorSource.value = 'azure'
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
      onLoad(snapshot, `Azure · ${new Date().toLocaleString()}`)
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

  return {
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
  }
}
