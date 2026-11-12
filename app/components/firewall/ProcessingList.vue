<script setup lang="ts">
import type {
  FirewallProcessingPlan,
  FirewallSimulationResult,
  FirewallSnapshot,
  SimulationTraceEntry,
  SimulatorRule,
  SimulatorRuleType,
} from '#shared/types/firewallSimulator'

const props = defineProps<{
  plan: FirewallProcessingPlan
  snapshot: FirewallSnapshot
  result: FirewallSimulationResult | null
}>()

const root = useTemplateRef('root')
const afterCollections = useTemplateRef('afterCollections')
const afterCollectionsOpen = ref(false)
const search = ref('')
const openCollections = ref(new Set<string>())
const types: SimulatorRuleType[] = ['DNAT', 'Network', 'Application']
const descriptions: Record<SimulatorRuleType, string> = {
  DNAT: 'A match translates and allows the connection, then stops configured-rule processing.',
  Network:
    'Inherited policies first, then the selected policy. A match stops before application rules.',
  Application:
    'Outbound HTTP, HTTPS, and MSSQL traffic reaches this pass when no network rule matches.',
}
const normalizedSearch = computed(() => search.value.trim().toLowerCase())
const collections = computed(() =>
  props.plan.collections.map((collection, index) => ({
    collection,
    ordinal: index + 1,
    searchText: [
      collection.name,
      collection.groupName,
      collection.policyName,
      ...collection.rules.map((rule) => rule.name),
    ]
      .join('\n')
      .toLowerCase(),
  })),
)
const visibleCollections = computed(() =>
  collections.value.filter((item) => item.searchText.includes(normalizedSearch.value)),
)
const sections = computed(() =>
  types.map((type) => ({
    type,
    total: collections.value.filter((item) => item.collection.ruleType === type).length,
    items: visibleCollections.value.filter((item) => item.collection.ruleType === type),
  })),
)
const traceByCollection = computed(() => {
  const entries = new Map<string, SimulationTraceEntry[]>()
  for (const entry of props.result?.trace ?? []) {
    const collection = entries.get(entry.collectionId) ?? []
    collection.push(entry)
    entries.set(entry.collectionId, collection)
  }
  return entries
})
const ipGroupsById = computed(
  () => new Map(props.snapshot.ipGroups.map((group) => [group.id.toLowerCase(), group])),
)
const decisionEntry = computed(() => {
  const result = props.result
  if (!result) {
    return
  }
  if (result.verdict === 'Indeterminate') {
    const unknown = result.trace.find((entry) => entry.status === 'unknown')
    if (unknown) {
      return unknown
    }
  }
  return result.trace.find((entry) => entry.status === 'match') ?? result.trace.at(-1)
})

watch(
  () => props.plan,
  () => {
    search.value = ''
    openCollections.value = new Set()
    afterCollectionsOpen.value = false
  },
)
watch(
  () => props.result,
  (result) => {
    openCollections.value = new Set(
      (result?.trace ?? [])
        .filter((entry) => entry.status === 'match' || entry.status === 'unknown')
        .map((entry) => entry.collectionId),
    )
    afterCollectionsOpen.value = false
  },
  { immediate: true },
)

function updateCollectionOpen(id: string, event: Event) {
  if (!(event.currentTarget instanceof HTMLDetailsElement)) {
    return
  }
  if (event.currentTarget.open) {
    openCollections.value.add(id)
  } else {
    openCollections.value.delete(id)
  }
}

function updateAfterCollectionsOpen(event: Event) {
  if (event.currentTarget instanceof HTMLDetailsElement) {
    afterCollectionsOpen.value = event.currentTarget.open
  }
}

function clearSearch() {
  search.value = ''
  root.value?.querySelector<HTMLInputElement>('#firewall-collection-search')?.focus()
}

async function focusDecision() {
  search.value = ''
  let summary: HTMLElement | null | undefined
  if (props.result?.cause === 'infrastructure' || props.result?.cause === 'default-deny') {
    afterCollectionsOpen.value = true
    await nextTick()
    summary = afterCollections.value?.querySelector<HTMLElement>('summary')
  } else {
    const entry = decisionEntry.value
    if (!entry) {
      return
    }
    openCollections.value.add(entry.collectionId)
    await nextTick()
    const selector = `[data-collection-id="${CSS.escape(entry.collectionId)}"] > summary`
    summary = root.value?.querySelector<HTMLElement>(selector)
  }
  summary?.focus({ preventScroll: true })
  summary?.scrollIntoView({ behavior: 'instant', block: 'center' })
}

defineExpose({ focusDecision })

function collectionState(id: string): string {
  const entries = traceByCollection.value.get(id)
  if (entries?.some((entry) => entry.status === 'unknown')) {
    return 'Unresolved'
  }
  if (entries?.some((entry) => entry.status === 'match')) {
    return 'Matching rule'
  }
  if (entries?.length && entries.every((entry) => entry.status === 'skipped')) {
    return 'Skipped'
  }
  return entries?.length ? 'No match' : 'Not reached'
}

function ruleTrace(id: string, rule: SimulatorRule): SimulationTraceEntry[] {
  return traceByCollection.value.get(id)?.filter((entry) => entry.ruleName === rule.name) ?? []
}

function displayValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item: unknown) => displayValue(item)).join(', ')
  }
  if (value === undefined || value === null || value === '') {
    return '—'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}

function addresses(rule: SimulatorRule, side: 'source' | 'destination'): string {
  const fields = rule.properties
  const parts: string[] = []
  const direct = fields[`${side}Addresses`]
  if (Array.isArray(direct) && direct.length > 0) {
    parts.push(displayValue(direct))
  }
  const groups = fields[`${side}IpGroups`]
  if (Array.isArray(groups)) {
    for (const id of groups) {
      if (typeof id !== 'string') {
        continue
      }
      const group = ipGroupsById.value.get(id.toLowerCase())
      parts.push(
        group
          ? `IP group ${group.name}: ${
              group.addresses.length > 0 ? group.addresses.join(', ') : 'empty, rule skipped'
            }`
          : `Unresolved IP group: ${id}`,
      )
    }
  }
  if (side === 'destination') {
    for (const field of [
      { key: 'destinationFqdns', label: 'Destination FQDNs' },
      { key: 'targetFqdns', label: 'Target FQDNs' },
      { key: 'targetUrls', label: 'Target URLs' },
      { key: 'fqdnTags', label: 'FQDN tags' },
      { key: 'webCategories', label: 'Web categories' },
    ]) {
      const values = fields[field.key]
      if (Array.isArray(values) && values.length > 0) {
        parts.push(`${field.label}: ${displayValue(values)}`)
      }
    }
  }
  const locations = fields[`${side}GeoLocations`]
  if (Array.isArray(locations) && locations.length > 0) {
    parts.push(`Geolocations: ${displayValue(locations)}`)
  }
  const selectors = fields['sourceKubeSelectorGroups']
  if (side === 'source' && Array.isArray(selectors) && selectors.length > 0) {
    parts.push(`Kubernetes selectors: ${displayValue(selectors)}`)
  }
  return parts.join(' · ') || '—'
}

function protocols(rule: SimulatorRule): string {
  const application = rule.properties['protocols']
  if (!Array.isArray(application)) {
    return `${displayValue(rule.properties['ipProtocols'])} / ${displayValue(
      rule.properties['destinationPorts'],
    )}`
  }
  return application
    .map((protocol: unknown) => {
      if (typeof protocol !== 'object' || protocol === null) {
        return displayValue(protocol)
      }
      const type =
        'protocolType' in protocol ? displayValue(protocol.protocolType).toUpperCase() : '?'
      const port = 'port' in protocol ? displayValue(protocol.port) : '?'
      return `${type}:${port}`
    })
    .join(', ')
}

const statusLabels = {
  match: 'Match',
  'no-match': 'No match',
  unknown: 'Unresolved',
  skipped: 'Skipped',
}
</script>

<template>
  <div ref="root" class="space-y-5">
    <div class="space-y-2">
      <div class="flex items-end gap-2">
        <UFormField
          label="Find a collection or rule"
          name="firewall-collection-search"
          class="min-w-0 flex-1"
        >
          <UInput
            id="firewall-collection-search"
            v-model="search"
            type="text"
            icon="i-lucide-search"
            placeholder="Collection or rule name"
            :spellcheck="false"
            :ui="{ base: 'min-h-11' }"
            class="w-full"
          />
        </UFormField>
        <UButton
          v-if="search !== ''"
          color="neutral"
          variant="ghost"
          class="min-h-11 shrink-0"
          @click="clearSearch"
          >Clear search</UButton
        >
      </div>
      <p aria-live="polite" aria-atomic="true" class="text-xs text-muted">
        {{ visibleCollections.length }} of {{ collections.length }} collections. Processing
        positions stay unchanged when filtering.
      </p>
    </div>

    <details class="border-y border-default">
      <summary
        class="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
      >
        Before collections: threat intelligence
      </summary>
      <div class="space-y-2 pb-3 text-sm text-muted">
        <p class="max-w-3xl">
          Threat intelligence runs first when enabled. Alert mode logs a match; Deny mode can block
          the connection. The live threat feed and allowlists are not evaluated here.
        </p>
        <ul class="space-y-1 text-xs">
          <li v-for="policy in plan.policyChain" :key="policy.id" class="break-words">
            {{ policy.name }}:
            {{ policy.settings['threatIntelMode'] ?? 'Inherited / Azure default' }}
          </li>
        </ul>
      </div>
    </details>

    <p
      v-if="visibleCollections.length === 0 && normalizedSearch !== ''"
      class="rounded-md border border-default p-4 text-sm text-muted"
    >
      No collections match “{{ search.trim() }}”. Try another collection, rule, group, or policy
      name, or clear the search.
    </p>

    <template v-for="section in sections" :key="section.type">
      <section
        v-if="normalizedSearch === '' || section.items.length > 0"
        :aria-label="`${section.type} collections`"
        class="space-y-3"
      >
        <div class="border-b border-default pb-2">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h3 class="font-semibold">{{ section.type }}</h3>
            <span class="text-xs text-muted">
              {{ section.items.length }}
              {{ section.items.length === 1 ? 'collection' : 'collections' }}
            </span>
          </div>
          <p class="mt-1 max-w-3xl text-sm text-muted">{{ descriptions[section.type] }}</p>
        </div>
        <p v-if="section.total === 0" class="text-sm text-muted">
          No {{ section.type === 'DNAT' ? 'DNAT' : section.type.toLowerCase() }} collections in this
          policy chain.
        </p>
        <ol class="space-y-2">
          <li
            v-for="{ collection, ordinal } in section.items"
            :key="collection.id"
            :value="ordinal"
          >
            <details
              :data-collection-id="collection.id"
              :open="openCollections.has(collection.id)"
              class="rounded-md border bg-default"
              :class="
                result && collectionState(collection.id) === 'Unresolved'
                  ? 'border-warning/60'
                  : result && collectionState(collection.id) === 'Matching rule'
                    ? 'border-primary/60'
                    : 'border-default'
              "
              @toggle="updateCollectionOpen(collection.id, $event)"
            >
              <summary
                class="min-h-11 cursor-pointer rounded-md p-3 focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span class="inline-flex w-[calc(100%-1.5rem)] items-start gap-2 align-top">
                  <span class="shrink-0 text-sm text-muted tabular-nums"
                    ><span class="sr-only">Processing position </span>{{ ordinal }}.</span
                  >
                  <span class="min-w-0 flex-1 space-y-1">
                    <span class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span class="font-semibold break-words">{{ collection.name }}</span>
                      <span
                        :class="collection.action === 'Deny' ? 'text-error' : 'text-success'"
                        class="text-sm font-medium"
                        >{{ collection.action }}</span
                      >
                      <span class="text-xs text-muted">
                        {{ collection.rules.length }}
                        {{ collection.rules.length === 1 ? 'rule' : 'rules' }}
                      </span>
                    </span>
                    <span class="block text-xs break-words text-muted">
                      {{ collection.policyName }}{{ collection.inherited ? ' (inherited)' : '' }} ·
                      {{ collection.groupName }} (group priority {{ collection.groupPriority }}) ·
                      collection priority
                      {{ collection.priority }}
                    </span>
                    <span
                      v-if="result"
                      class="block text-xs font-medium"
                      :class="
                        collectionState(collection.id) === 'Unresolved'
                          ? 'text-warning'
                          : collectionState(collection.id) === 'Not reached'
                            ? 'text-muted'
                            : 'text-default'
                      "
                      >{{ collectionState(collection.id) }}</span
                    >
                  </span>
                </span>
              </summary>
              <div
                v-if="openCollections.has(collection.id)"
                class="space-y-3 border-t border-default p-3"
              >
                <p class="text-xs text-muted">{{ collection.reason }}</p>
                <ol class="divide-y divide-default">
                  <li
                    v-for="(rule, index) in collection.rules"
                    :key="`${rule.name}-${index}`"
                    class="space-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <p class="text-sm font-medium break-words">{{ index + 1 }}. {{ rule.name }}</p>
                    <dl class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                      <div>
                        <dt class="text-muted">Source</dt>
                        <dd class="mt-1 break-words">{{ addresses(rule, 'source') }}</dd>
                      </div>
                      <div>
                        <dt class="text-muted">Destination</dt>
                        <dd class="mt-1 break-words">{{ addresses(rule, 'destination') }}</dd>
                      </div>
                      <div>
                        <dt class="text-muted">Protocol / port</dt>
                        <dd class="mt-1 break-words">{{ protocols(rule) }}</dd>
                      </div>
                      <div v-if="rule.ruleType === 'DNAT'" class="sm:col-span-3">
                        <dt class="text-muted">Translated destination</dt>
                        <dd class="mt-1 break-words">
                          {{
                            displayValue(
                              rule.properties['translatedAddress'] ??
                                rule.properties['translatedFqdn'],
                            )
                          }}:{{ displayValue(rule.properties['translatedPort']) }}
                        </dd>
                      </div>
                    </dl>
                    <p
                      v-for="(entry, traceIndex) in ruleTrace(collection.id, rule)"
                      :key="traceIndex"
                      class="text-sm"
                      :class="
                        entry.status === 'match'
                          ? 'text-success'
                          : entry.status === 'unknown'
                            ? 'text-warning'
                            : 'text-muted'
                      "
                    >
                      {{ statusLabels[entry.status] }}. {{ entry.reason }}
                    </p>
                    <p
                      v-if="result && ruleTrace(collection.id, rule).length === 0"
                      class="text-xs text-muted"
                    >
                      Not reached. Processing stopped before this rule.
                    </p>
                    <details class="text-xs text-muted">
                      <summary
                        class="min-h-11 w-fit cursor-pointer py-3 focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        Rule JSON
                      </summary>
                      <pre class="overflow-auto rounded bg-muted p-3">{{
                        JSON.stringify(rule.properties, null, 2)
                      }}</pre>
                    </details>
                  </li>
                </ol>
              </div>
            </details>
          </li>
        </ol>
      </section>
    </template>

    <details
      ref="afterCollections"
      :open="afterCollectionsOpen"
      class="border-t border-default"
      @toggle="updateAfterCollectionsOpen"
    >
      <summary
        class="min-h-11 cursor-pointer py-3 text-sm focus-visible:outline-2 focus-visible:outline-primary"
      >
        After collections: infrastructure and default deny
      </summary>
      <p class="max-w-3xl pb-3 text-sm text-muted">
        Unmatched application traffic can reach Azure’s built-in infrastructure collection, then
        default deny. IDPS may log in parallel or block after a configured-rule match. Routing, DNS,
        TLS, threat feeds, and established connections can also affect actual traffic.
      </p>
    </details>
  </div>
</template>
