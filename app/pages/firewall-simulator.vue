<script setup lang="ts">
import type { FirewallSnapshot, SimulatorTraffic } from '#shared/types/firewallSimulator'

defineOptions({ name: 'FirewallSimulatorPage' })
definePageMeta({ layout: 'application' })
useHead({ title: 'Rule simulator | Azure Argus' })

const {
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
  loadSnapshot: setSnapshot,
  simulate: evaluate,
  downloadSnapshot,
} = useFirewallSimulator()
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
const configurationToggle = useTemplateRef<{ $el: HTMLButtonElement }>('configurationToggle')
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

async function loadSnapshot(value: FirewallSnapshot, label: string, preset?: SimulatorTraffic) {
  setSnapshot(value, label, preset)
  await nextTick()
  if (configurationIssues.value.length > 0) {
    incompleteHeading.value?.focus()
  } else {
    connectionHeading.value?.focus()
  }
}

async function simulate() {
  evaluate()
  await nextTick()
  if (Object.keys(fieldErrors.value).length > 0) {
    connectionForm.value?.querySelector<HTMLInputElement>('input[aria-invalid="true"]')?.focus()
  } else if (result.value) {
    resultHeading.value?.focus({ preventScroll: true })
    resultPanel.value?.scrollIntoView({ behavior: 'instant', block: 'nearest' })
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
  configurationToggle.value?.$el.focus()
}
</script>

<template>
  <div
    ref="viewport"
    class="firewall-simulator touch-fields relative h-full overflow-y-auto bg-default text-default"
  >
    <div class="simulator-page">
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">Firewall rule simulator</h1>
          <p class="mt-1 max-w-3xl text-sm text-muted">
            Test a connection and see which policy rule decides its outcome.
          </p>
        </div>
      </header>

      <section class="rounded-lg border border-default" aria-label="Configuration">
        <div class="simulator-source-header px-4 py-3">
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold">
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
          <div v-if="snapshot" class="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <UButton
              ref="configurationToggle"
              color="neutral"
              variant="outline"
              :icon="sourceOpen ? 'i-lucide-chevron-up' : 'i-lucide-upload'"
              :aria-expanded="sourceOpen"
              aria-controls="simulator-source"
              @click="sourceOpen ? hideImportOptions() : reviewConfiguration()"
              >{{ sourceOpen ? 'Hide import options' : 'Import another configuration' }}</UButton
            >
            <UTooltip text="Download snapshot">
              <UButton
                icon="i-lucide-download"
                variant="ghost"
                color="neutral"
                aria-label="Download snapshot"
                @click="downloadSnapshot"
              >
                <span class="hidden sm:inline">Download snapshot</span>
              </UButton>
            </UTooltip>
          </div>
        </div>
        <div v-show="sourceOpen" id="simulator-source" class="border-t border-default p-4">
          <FirewallSimulatorSource
            ref="sourceComponent"
            :has-configuration="Boolean(snapshot)"
            @load="loadSnapshot"
          />
        </div>
      </section>

      <template v-if="snapshot && plan">
        <section
          v-if="configurationIssues.length"
          aria-labelledby="incomplete-heading"
          class="status-panel space-y-3"
          data-tone="warning"
        >
          <h2
            id="incomplete-heading"
            ref="incompleteHeading"
            tabindex="-1"
            class="status-heading flex items-center gap-2 text-lg font-semibold"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-5 shrink-0" />
            Configuration is incomplete
          </h2>
          <ul class="list-disc space-y-2 pl-5 text-sm">
            <li v-for="reason in configurationIssues" :key="reason">{{ reason }}</li>
          </ul>
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
                  class="simulator-identifiers w-full"
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
                  class="simulator-identifiers w-full"
                />
              </UFormField>
              <UFormField label="IP protocol" name="simulator-protocol">
                <USelect
                  id="simulator-protocol"
                  v-model:open="protocolMenuOpen"
                  v-model="traffic.protocol"
                  :items="['TCP', 'UDP', 'ICMP']"
                  class="w-full"
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
                  class="simulator-identifiers w-full"
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
                  class="simulator-identifiers w-full"
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
              <UButton type="submit" icon="i-lucide-play" class="w-full sm:w-auto">
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
          <AppNotice
            v-if="lastError"
            tone="error"
            title="Simulation failed"
            :description="lastError"
          />

          <section
            v-if="result"
            ref="resultPanel"
            role="status"
            aria-live="polite"
            aria-labelledby="simulation-result"
            class="status-panel simulator-result space-y-3"
            :data-tone="resultPresentation.tone"
          >
            <div class="flex items-start gap-3">
              <UIcon
                :name="
                  result.verdict === 'Indeterminate'
                    ? 'i-lucide-circle-help'
                    : result.verdict === 'Deny'
                      ? 'i-lucide-circle-x'
                      : 'i-lucide-circle-check'
                "
                class="status-heading mt-0.5 size-5 shrink-0"
              />
              <div class="min-w-0 flex-1 space-y-2">
                <h2
                  id="simulation-result"
                  ref="resultHeading"
                  tabindex="-1"
                  class="status-heading text-lg font-semibold"
                >
                  {{ resultPresentation.label }}
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
                <p class="text-sm [overflow-wrap:anywhere]">
                  {{
                    result.cause === 'incomplete-policy'
                      ? 'The incomplete configuration above prevents a conclusive result.'
                      : resultSummary
                  }}
                </p>
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
                    @click="processingList?.focusDecision()"
                    >Inspect evaluation</UButton
                  >
                  <UButton
                    v-if="resultNeedsConfiguration"
                    color="neutral"
                    variant="outline"
                    icon="i-lucide-folder-open"
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
          <AppDisclosure
            v-if="warnings.length"
            :open="!plan.complete || result?.verdict === 'Indeterminate'"
            :title="`Evaluation notes (${warnings.length})`"
          >
            <ul class="list-disc space-y-2 pl-5 text-muted">
              <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
            </ul>
          </AppDisclosure>
          <FirewallProcessingList
            ref="processingList"
            :snapshot="snapshot"
            :plan="plan"
            :result="result"
          />
          <AppDisclosure
            v-if="snapshot.ipGroups.length"
            :title="`Resolved IP groups (${snapshot.ipGroups.length})`"
          >
            <dl class="grid gap-4 text-sm sm:grid-cols-2">
              <div v-for="group in snapshot.ipGroups" :key="group.id" class="min-w-0">
                <dt class="font-medium">{{ group.name }}</dt>
                <dd class="mt-1 font-mono break-words">
                  {{ group.addresses.join(', ') || 'Empty: referencing rules are skipped' }}
                </dd>
                <dd class="mt-1 font-mono text-xs break-all text-muted">{{ group.id }}</dd>
              </div>
            </dl>
          </AppDisclosure>
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
