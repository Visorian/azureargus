import type { ComputedRef, Ref, ShallowRef } from 'vue'

import type {
  FirewallProcessingPlan,
  FirewallSimulationResult,
  FirewallSnapshot,
  FirewallTrafficErrors,
  SimulatorTraffic,
} from '#shared/types/firewallSimulator'
import {
  buildFirewallProcessingPlan,
  exportFirewallSnapshot,
  simulateFirewallTraffic,
  validateFirewallTraffic,
} from '#shared/utils/firewallSimulator'
import {
  resourceName,
  simulatorReason,
  simulatorResultPresentation,
} from '~/utils/simulatorPresentation'

interface FirewallSimulatorState {
  snapshot: ShallowRef<FirewallSnapshot | null>
  sourceLabel: Ref<string>
  sourceOpen: Ref<boolean>
  policyId: Ref<string>
  result: ShallowRef<FirewallSimulationResult | null>
  lastError: Ref<string | null>
  resultNeedsUpdate: Ref<boolean>
  traffic: SimulatorTraffic
  portValue: Ref<string>
  fieldErrors: ComputedRef<FirewallTrafficErrors>
  policyOptions: ComputedRef<{ label: string; value: string }[]>
  plan: ComputedRef<FirewallProcessingPlan | null>
  configurationIssues: ComputedRef<string[]>
  warnings: ComputedRef<string[]>
  resultNotes: ComputedRef<string[]>
  resultSummary: ComputedRef<string>
  applicationRequest: ComputedRef<boolean>
  resultNeedsConfiguration: ComputedRef<boolean>
  resultPresentation: ComputedRef<ReturnType<typeof simulatorResultPresentation>>
  loadSnapshot: (value: FirewallSnapshot, label: string, preset?: SimulatorTraffic) => void
  simulate: () => void
  downloadSnapshot: () => void
}

export function useFirewallSimulator(): FirewallSimulatorState {
  const snapshot = shallowRef<FirewallSnapshot | null>(null)
  const sourceLabel = ref('')
  const sourceOpen = ref(true)
  const policyId = ref('')
  const result = shallowRef<FirewallSimulationResult | null>(null)
  const lastError = ref<string | null>(null)
  const validationAttempted = ref(false)
  const resultNeedsUpdate = ref(false)
  const defaultTraffic: SimulatorTraffic = {
    sourceIp: '',
    destinationIp: '',
    destinationPort: '443',
    protocol: 'TCP',
    applicationProtocol: 'None',
    targetFqdn: '',
    direction: 'outbound',
  }
  const traffic = reactive<SimulatorTraffic>({ ...defaultTraffic })
  const portValue = computed({
    get: () => (traffic.protocol === 'ICMP' ? '' : traffic.destinationPort),
    set: (value: string) => {
      traffic.destinationPort = value
    },
  })
  const fieldErrors = computed<FirewallTrafficErrors>(() =>
    validationAttempted.value ? validateFirewallTraffic(traffic) : {},
  )
  const policyOptions = computed(() => {
    const policies = snapshot.value?.policies ?? []
    return policies.map((policy) => {
      const duplicate = policies.some(
        (other) => other.id !== policy.id && other.name.toLowerCase() === policy.name.toLowerCase(),
      )
      const parts = policy.id.split('/')
      const context = parts[4] === undefined ? policy.id : `${parts[4]}, ${parts[2]}`
      return { label: duplicate ? `${policy.name} (${context})` : policy.name, value: policy.id }
    })
  })
  const plan = computed(() =>
    snapshot.value && policyId.value.length > 0
      ? buildFirewallProcessingPlan(snapshot.value, policyId.value)
      : null,
  )
  const configurationIssues = computed(() => [
    ...(plan.value?.incompleteReasons ?? []),
    ...(plan.value?.missingIpGroupIds.map(
      (id) =>
        `IP group ${resourceName(id)} is missing. Include referenced IP groups in the export.`,
    ) ?? []),
  ])
  const warnings = computed(() =>
    [...new Set([...(plan.value?.warnings ?? []), ...(result.value?.warnings ?? [])])]
      .filter((warning) => plan.value?.incompleteReasons.includes(warning) !== true)
      .map((warning) => simulatorReason(warning, plan.value?.missingIpGroupIds ?? [])),
  )
  const resultNotes = computed(() => {
    if (result.value?.cause === 'incomplete-policy') {
      return plan.value?.incompleteReasons.slice(1) ?? []
    }
    if (result.value?.cause === 'unresolved-rule') {
      return [
        ...new Set(
          result.value.trace
            .filter((entry) => entry.status === 'unknown')
            .map((entry) => entry.reason),
        ),
      ]
        .slice(1)
        .map((reason) => simulatorReason(reason, plan.value?.missingIpGroupIds ?? []))
    }
    return []
  })
  const resultSummary = computed(() =>
    simulatorReason(result.value?.summary ?? '', plan.value?.missingIpGroupIds ?? []),
  )
  const applicationRequest = computed(
    () => traffic.protocol === 'TCP' && traffic.applicationProtocol !== 'None',
  )
  const resultNeedsConfiguration = computed(
    () =>
      result.value?.cause === 'incomplete-policy' ||
      (result.value?.cause === 'unresolved-rule' &&
        (plan.value?.missingIpGroupIds.length ?? 0) > 0),
  )
  function loadSnapshot(value: FirewallSnapshot, label: string, preset?: SimulatorTraffic) {
    snapshot.value = value
    sourceLabel.value = label
    const child = value.policies.find((policy) => (policy.basePolicyId?.length ?? 0) > 0)
    policyId.value = child?.id ?? value.policies[0]?.id ?? ''
    result.value = null
    lastError.value = null
    validationAttempted.value = false
    resultNeedsUpdate.value = false
    sourceOpen.value = false
    Object.assign(traffic, preset ?? defaultTraffic)
  }

  watch([policyId, traffic], () => {
    if (result.value) {
      resultNeedsUpdate.value = true
    }
    result.value = null
    lastError.value = null
  })
  watch(
    () => traffic.protocol,
    (protocol) => {
      if (protocol !== 'TCP') {
        traffic.applicationProtocol = 'None'
      }
    },
  )

  function simulate() {
    lastError.value = null
    if (!snapshot.value || !plan.value) {
      return
    }
    validationAttempted.value = true
    if (Object.keys(fieldErrors.value).length > 0) {
      return
    }
    try {
      result.value = simulateFirewallTraffic(snapshot.value, plan.value, traffic)
      resultNeedsUpdate.value = false
    } catch (error: unknown) {
      lastError.value =
        error instanceof Error ? error.message : 'Could not simulate this connection.'
    }
  }

  function downloadSnapshot() {
    if (!snapshot.value) {
      return
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exportFirewallSnapshot(snapshot.value), null, 2)], {
        type: 'application/json',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'firewall-configuration.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  const resultPresentation = computed(() => simulatorResultPresentation(result.value))
  return {
    snapshot,
    sourceLabel,
    sourceOpen,
    policyId,
    result,
    lastError,
    resultNeedsUpdate,
    traffic,
    portValue,
    fieldErrors,
    policyOptions,
    plan,
    configurationIssues,
    warnings,
    resultNotes,
    resultSummary,
    applicationRequest,
    resultNeedsConfiguration,
    resultPresentation,
    loadSnapshot,
    simulate,
    downloadSnapshot,
  }
}
