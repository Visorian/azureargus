<script setup lang="ts">
import type {
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

defineOptions({ name: 'FirewallSimulatorPage' })
definePageMeta({ layout: 'application' })
useHead({ title: 'Rule simulator | Azure Argus' })

const snapshot = shallowRef<FirewallSnapshot | null>(null)
const sourceLabel = ref('')
const sourceOpen = ref(true)
const policyId = ref('')
const result = shallowRef<FirewallSimulationResult | null>(null)
const lastError = ref<string | null>(null)
const validationAttempted = ref(false)
const resultNeedsUpdate = ref(false)
const policyMenuOpen = ref(false)
const protocolMenuOpen = ref(false)
const applicationMenuOpen = ref(false)
const directionMenuOpen = ref(false)
onDeactivated(() => {
  for (const menu of [policyMenuOpen, protocolMenuOpen, applicationMenuOpen, directionMenuOpen]) {
    menu.value = false
  }
})
const connectionForm = useTemplateRef<HTMLFormElement>('connectionForm')
const connectionHeading = useTemplateRef<HTMLHeadingElement>('connectionHeading')
const resultHeading = useTemplateRef<HTMLHeadingElement>('resultHeading')
const resultPanel = useTemplateRef<HTMLElement>('resultPanel')
const incompleteHeading = useTemplateRef<HTMLHeadingElement>('incompleteHeading')
const configurationActions = useTemplateRef<HTMLDivElement>('configurationActions')
const viewport = useTemplateRef<HTMLDivElement>('viewport')
let savedScrollTop = 0
onBeforeRouteLeave(() => {
  savedScrollTop = viewport.value?.scrollTop ?? 0
})
onActivated(async () => {
  await nextTick()
  viewport.value?.scrollTo({ top: savedScrollTop, behavior: 'instant' })
})
const sourceComponent = useTemplateRef<{ focusImport: () => Promise<void> }>('sourceComponent')
const processingList = useTemplateRef<{ focusDecision: () => Promise<void> }>('processingList')
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
    const context = parts[4] ? `${parts[4]}, ${parts[2]}` : policy.id
    return { label: duplicate ? `${policy.name} (${context})` : policy.name, value: policy.id }
  })
})
const plan = computed(() =>
  snapshot.value && policyId.value
    ? buildFirewallProcessingPlan(snapshot.value, policyId.value)
    : null,
)
const configurationIssues = computed(() => [
  ...(plan.value?.incompleteReasons ?? []),
  ...(plan.value?.missingIpGroupIds.map(
    (id) => `IP group ${id} is missing. Get export command includes referenced IP groups.`,
  ) ?? []),
])
const warnings = computed(() =>
  [...new Set([...(plan.value?.warnings ?? []), ...(result.value?.warnings ?? [])])].filter(
    (warning) => !plan.value?.incompleteReasons.includes(warning),
  ),
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
    ].slice(1)
  }
  return []
})
const applicationRequest = computed(
  () => traffic.protocol === 'TCP' && traffic.applicationProtocol !== 'None',
)
const resultNeedsConfiguration = computed(
  () =>
    result.value?.cause === 'incomplete-policy' ||
    (result.value?.cause === 'unresolved-rule' && (plan.value?.missingIpGroupIds.length ?? 0) > 0),
)
const resultClass = computed(() => {
  if (result.value?.verdict === 'Indeterminate') {
    return 'border-warning/40 bg-warning/5'
  }
  if (result.value?.verdict === 'Deny') {
    return 'border-error/40 bg-error/5'
  }
  return 'border-success/40 bg-success/5'
})
const resultLabel = computed(() => {
  const decision = result.value
  if (!decision) {
    return ''
  }
  if (decision.verdict === 'Indeterminate') {
    return 'Indeterminate'
  }
  if (decision.verdict === 'Deny' && !decision.trace.some((entry) => entry.status === 'match')) {
    return 'Deny (default)'
  }
  if (decision.verdict === 'DNAT') {
    return 'Allow and translate (DNAT)'
  }
  return `${decision.verdict} by configured rules`
})
const resultIcon = computed(() => {
  if (result.value?.verdict === 'Indeterminate') {
    return 'i-lucide-circle-help'
  }
  if (result.value?.verdict === 'Deny') {
    return 'i-lucide-circle-x'
  }
  return 'i-lucide-circle-check'
})

async function loadSnapshot(value: FirewallSnapshot, label: string, preset?: SimulatorTraffic) {
  snapshot.value = value
  sourceLabel.value = label
  const child = value.policies.find((policy) => policy.basePolicyId)
  policyId.value = child?.id ?? value.policies[0]?.id ?? ''
  result.value = null
  lastError.value = null
  validationAttempted.value = false
  resultNeedsUpdate.value = false
  sourceOpen.value = false
  Object.assign(traffic, preset ?? defaultTraffic)
  await nextTick()
  if (configurationIssues.value.length > 0) {
    incompleteHeading.value?.focus()
  } else {
    connectionHeading.value?.focus()
  }
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

async function simulate() {
  lastError.value = null
  if (!snapshot.value || !plan.value) {
    return
  }
  validationAttempted.value = true
  if (Object.keys(fieldErrors.value).length > 0) {
    await nextTick()
    connectionForm.value?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()
    return
  }
  try {
    result.value = simulateFirewallTraffic(snapshot.value, plan.value, traffic)
    resultNeedsUpdate.value = false
    await nextTick()
    resultHeading.value?.focus({ preventScroll: true })
    resultPanel.value?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
  } catch (error: unknown) {
    lastError.value = error instanceof Error ? error.message : 'Could not simulate this connection.'
  }
}

async function reviewConfiguration() {
  sourceOpen.value = true
  await nextTick()
  await sourceComponent.value?.focusImport()
}

async function hideImportOptions() {
  sourceOpen.value = false
  await nextTick()
  configurationActions.value
    ?.querySelector<HTMLButtonElement>('button[data-import-configuration]')
    ?.focus()
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
</script>

<template>
  <div
    ref="viewport"
    class="firewall-simulator touch-fields relative h-full overflow-y-auto bg-default text-default"
  >
    <div class="mx-auto max-w-400 space-y-6 p-4 pb-8 sm:p-6">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Firewall rule simulator</h1>
          <p class="mt-1 max-w-3xl text-sm text-muted">
            Test a connection and see which policy rule decides its outcome.
          </p>
        </div>
        <div
          v-if="snapshot"
          ref="configurationActions"
          class="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap"
        >
          <UButton
            icon="i-lucide-upload"
            variant="outline"
            class="min-h-11 justify-center"
            aria-controls="simulator-source"
            data-import-configuration
            @click="reviewConfiguration"
            >Import another configuration</UButton
          >
          <UButton
            icon="i-lucide-download"
            variant="outline"
            color="neutral"
            class="min-h-11 justify-center"
            @click="downloadSnapshot"
            >Download snapshot</UButton
          >
        </div>
      </header>

      <section class="rounded-lg border border-default" aria-label="Configuration">
        <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0 flex-1">
            <h2 class="font-semibold">
              {{ snapshot ? 'Configuration source' : 'Load a configuration' }}
            </h2>
            <p
              v-if="snapshot"
              class="mt-0.5 text-sm [overflow-wrap:anywhere] text-muted"
              :title="sourceLabel"
            >
              {{ sourceLabel }}
            </p>
            <p v-else class="mt-1 text-sm text-muted">
              Import your policies, or use the example to try an inherited policy and IP groups.
            </p>
          </div>
          <UButton
            v-if="snapshot && sourceOpen"
            color="neutral"
            variant="ghost"
            icon="i-lucide-chevron-up"
            class="min-h-11"
            aria-label="Hide import options"
            aria-controls="simulator-source"
            @click="hideImportOptions"
            ><span class="sm:hidden">Hide</span>
            <span class="hidden sm:inline">Hide import options</span>
          </UButton>
        </div>
        <div v-show="sourceOpen" id="simulator-source" class="border-t border-default p-4">
          <FirewallSimulatorSource ref="sourceComponent" @load="loadSnapshot" />
        </div>
      </section>

      <template v-if="snapshot && plan">
        <section
          v-if="configurationIssues.length"
          aria-labelledby="incomplete-heading"
          class="space-y-3 rounded-lg border border-warning/40 p-4 [overflow-wrap:anywhere]"
        >
          <h2 id="incomplete-heading" ref="incompleteHeading" tabindex="-1" class="font-semibold">
            Configuration is incomplete
          </h2>
          <ul class="list-disc space-y-2 pl-5 text-sm">
            <li v-for="reason in configurationIssues" :key="reason">{{ reason }}</li>
          </ul>
          <UButton color="neutral" variant="outline" class="min-h-11" @click="reviewConfiguration">
            Review configuration
          </UButton>
        </section>
        <section aria-labelledby="connection-heading" class="space-y-4">
          <div class="flex flex-wrap items-end justify-between gap-4">
            <div class="min-w-0">
              <h2
                id="connection-heading"
                ref="connectionHeading"
                tabindex="-1"
                class="text-lg font-semibold"
              >
                Test a new connection
              </h2>
              <p class="mt-1 text-sm text-muted">
                One IPv4 source and destination per test. CIDRs and ranges are resolved in the
                policy rules.
              </p>
            </div>
            <UFormField label="Evaluate policy" name="simulator-policy" class="w-full sm:max-w-88">
              <USelect
                id="simulator-policy"
                v-model:open="policyMenuOpen"
                v-model="policyId"
                :items="policyOptions"
                class="w-full"
                :ui="{ base: 'min-h-11' }"
              />
            </UFormField>
          </div>
          <div
            class="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-default pb-3 text-sm"
          >
            <p class="min-w-0 break-words">
              <span class="text-muted">Policy chain: </span>
              {{ plan.policyChain.map((policy) => policy.name).join(' → ') }}
            </p>
            <p class="text-muted">
              {{ plan.collections.length }} collections · {{ snapshot.ipGroups.length }} IP groups
            </p>
          </div>
          <form ref="connectionForm" novalidate class="space-y-4" @submit.prevent="simulate">
            <div class="grid grid-cols-2 gap-4 xl:grid-cols-4">
              <UFormField
                label="Source IPv4 address"
                name="sourceIp"
                :error="fieldErrors.sourceIp"
                class="col-span-2 sm:col-span-1"
                required
              >
                <UInput
                  id="simulator-source-ip"
                  v-model.trim="traffic.sourceIp"
                  required
                  placeholder="e.g. 10.20.0.10"
                  :spellcheck="false"
                  autocapitalize="off"
                  autocomplete="off"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <UFormField
                label="Destination IPv4 address"
                name="destinationIp"
                :error="fieldErrors.destinationIp"
                class="col-span-2 sm:col-span-1"
                required
              >
                <UInput
                  id="simulator-destination-ip"
                  v-model.trim="traffic.destinationIp"
                  required
                  placeholder="e.g. 10.30.0.4"
                  :spellcheck="false"
                  autocapitalize="off"
                  autocomplete="off"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <UFormField label="IP protocol" name="simulator-protocol">
                <USelect
                  id="simulator-protocol"
                  v-model:open="protocolMenuOpen"
                  v-model="traffic.protocol"
                  :items="['TCP', 'UDP', 'ICMP']"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <UFormField
                label="Destination port"
                name="destinationPort"
                :error="fieldErrors.destinationPort"
                :help="traffic.protocol === 'ICMP' ? 'ICMP does not use ports.' : undefined"
                :required="traffic.protocol !== 'ICMP'"
              >
                <UInput
                  id="simulator-port"
                  v-model.trim="portValue"
                  :placeholder="traffic.protocol === 'ICMP' ? 'Not used' : undefined"
                  inputmode="numeric"
                  :disabled="traffic.protocol === 'ICMP'"
                  :required="traffic.protocol !== 'ICMP'"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <UFormField
                label="Direction"
                name="simulator-direction"
                :help="traffic.direction === 'outbound' ? 'Includes east-west traffic.' : undefined"
              >
                <USelect
                  id="simulator-direction"
                  v-model:open="directionMenuOpen"
                  v-model="traffic.direction"
                  :items="[
                    { label: 'Outbound', value: 'outbound' },
                    { label: 'Inbound', value: 'inbound' },
                  ]"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <UFormField
                label="Application protocol"
                name="simulator-application"
                :help="traffic.protocol !== 'TCP' ? 'Application rules need TCP.' : undefined"
              >
                <USelect
                  id="simulator-application"
                  v-model:open="applicationMenuOpen"
                  v-model="traffic.applicationProtocol"
                  :disabled="traffic.protocol !== 'TCP'"
                  :items="[
                    { label: 'None', value: 'None' },
                    { label: 'HTTP', value: 'Http' },
                    { label: 'HTTPS', value: 'Https' },
                    { label: 'MSSQL', value: 'Mssql' },
                  ]"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <UFormField
                v-if="applicationRequest"
                label="Host / SNI"
                name="targetFqdn"
                :error="fieldErrors.targetFqdn"
                help="Use the hostname the client sends, not a reverse DNS name."
                class="col-span-2"
                required
              >
                <UInput
                  id="simulator-host"
                  v-model.trim="traffic.targetFqdn"
                  required
                  placeholder="e.g. app.example.com"
                  :spellcheck="false"
                  autocapitalize="off"
                  autocomplete="off"
                  class="w-full"
                  :ui="{ base: 'min-h-11' }"
                />
              </UFormField>
              <p
                v-else-if="traffic.protocol === 'TCP'"
                class="col-span-2 self-center text-sm text-muted"
              >
                Choose HTTP, HTTPS, or MSSQL to evaluate application hostname rules.
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-3">
              <UButton type="submit" icon="i-lucide-play" class="min-h-11 w-full sm:w-auto">
                Simulate connection
              </UButton>
              <p
                aria-live="polite"
                aria-atomic="true"
                class="text-sm text-muted"
                :class="{ 'sr-only': !resultNeedsUpdate }"
              >
                {{
                  resultNeedsUpdate
                    ? 'Connection or policy changed. Simulate again to update the result.'
                    : ''
                }}
              </p>
            </div>
          </form>
          <UAlert v-if="lastError" color="error" variant="subtle" :title="lastError" role="alert" />

          <section
            v-if="result"
            ref="resultPanel"
            role="status"
            aria-live="polite"
            aria-labelledby="simulation-result"
            class="space-y-3 rounded-lg border p-4 sm:p-5"
            :class="resultClass"
          >
            <div class="flex items-start gap-3">
              <UIcon :name="resultIcon" class="mt-0.5 size-5 shrink-0" />
              <div class="min-w-0 flex-1 space-y-2">
                <h2
                  id="simulation-result"
                  ref="resultHeading"
                  tabindex="-1"
                  class="text-lg font-semibold"
                >
                  {{ resultLabel }}
                </h2>
                <p class="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                  <span class="sr-only">Connection from</span>
                  <code>{{ traffic.sourceIp }}</code>
                  <span aria-hidden="true">→</span>
                  <span class="sr-only">to</span>
                  <code
                    >{{ traffic.destinationIp
                    }}{{ traffic.protocol === 'ICMP' ? '' : `:${traffic.destinationPort}` }}</code
                  >
                  <span>({{ traffic.protocol }})</span>
                </p>
                <p v-if="applicationRequest" class="text-sm break-words">
                  {{ traffic.applicationProtocol.toUpperCase() }} host:
                  <code>{{ traffic.targetFqdn || 'Not provided' }}</code>
                </p>
                <p class="text-sm [overflow-wrap:anywhere]">{{ result.summary }}</p>
                <ul v-if="resultNotes.length" class="list-disc space-y-1 pl-4 text-sm">
                  <li v-for="reason in resultNotes" :key="reason">{{ reason }}</li>
                </ul>
                <p v-if="result.translation" class="text-sm break-all">
                  Translated endpoint: <code>{{ result.translation }}</code>
                </p>
                <div class="flex flex-wrap gap-2">
                  <UButton
                    v-if="result.cause !== 'incomplete-policy'"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-list-filter"
                    class="min-h-11"
                    @click="processingList?.focusDecision()"
                    >Inspect evaluation</UButton
                  >
                  <UButton
                    v-if="resultNeedsConfiguration"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-folder-open"
                    class="min-h-11"
                    @click="reviewConfiguration"
                  >
                    Review configuration
                  </UButton>
                </div>
                <p class="text-xs text-muted">
                  Configured-rule result. Routing, live DNS, threat intelligence, TLS inspection and
                  IDPS can affect actual traffic.
                </p>
              </div>
            </div>
          </section>
        </section>

        <section
          aria-label="Effective processing order"
          class="space-y-4 border-t border-default pt-5"
        >
          <div>
            <h2 class="text-lg font-semibold">Effective processing order</h2>
            <p class="mt-1 max-w-3xl text-sm text-muted">
              DNAT, then network, then application rules. Within each type, the base policy runs
              first. Lower group and collection priorities run first in their scope.
            </p>
          </div>
          <details
            v-if="warnings.length"
            :open="!plan.complete || result?.verdict === 'Indeterminate'"
            class="rounded-md border border-warning/40 px-3 text-sm"
          >
            <summary class="min-h-11 cursor-pointer py-3 font-medium">
              Evaluation notes ({{ warnings.length }})
            </summary>
            <ul class="list-disc space-y-2 pb-3 pl-5 text-muted">
              <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
            </ul>
          </details>
          <FirewallProcessingList
            ref="processingList"
            :snapshot="snapshot"
            :plan="plan"
            :result="result"
          />
          <details v-if="snapshot.ipGroups.length" class="border-t border-default pt-2">
            <summary class="min-h-11 cursor-pointer py-3 text-sm font-semibold">
              Resolved IP groups ({{ snapshot.ipGroups.length }})
            </summary>
            <dl class="grid gap-4 py-3 text-sm sm:grid-cols-2">
              <div v-for="group in snapshot.ipGroups" :key="group.id" class="min-w-0">
                <dt class="font-medium">{{ group.name }}</dt>
                <dd class="mt-1 break-words">
                  {{ group.addresses.join(', ') || 'Empty: referencing rules are skipped' }}
                </dd>
                <dd class="mt-1 text-xs break-all text-muted">{{ group.id }}</dd>
              </div>
            </dl>
          </details>
        </section>
      </template>

      <footer class="border-t border-default pt-4 text-xs leading-relaxed text-muted">
        <p class="max-w-4xl">
          Processing follows Microsoft’s
          <a
            href="https://learn.microsoft.com/en-us/azure/firewall/rule-processing"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
            >rule processing</a
          >,
          <a
            href="https://learn.microsoft.com/en-us/azure/firewall-manager/policy-overview"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
            >policy inheritance</a
          >, and
          <a
            href="https://learn.microsoft.com/en-us/azure/firewall/ip-groups"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary underline"
            >IP group</a
          >
          documentation. Parent DNAT is excluded according to the explicit inheritance
          documentation; Microsoft’s processing example differs.
        </p>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.firewall-simulator {
  --ui-success: var(--color-brand-turquoise-700);
  --ui-error: var(--color-brand-pink-700);
  --ui-warning: var(--color-brand-orange-700);
}
:global(.dark .firewall-simulator) {
  --ui-success: var(--color-brand-turquoise-300);
  --ui-error: var(--color-brand-pink-300);
  --ui-warning: var(--color-brand-orange-300);
}
</style>
