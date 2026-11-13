<script setup lang="ts">
import type {
  FirewallProcessingPlan,
  FirewallSimulationResult,
  FirewallSnapshot,
} from '#shared/types/firewallSimulator'
import {
  simulatorAddresses,
  simulatorDisplayValue,
  simulatorProtocols,
  simulatorReason,
  SIMULATOR_TRACE_LABELS,
} from '~/utils/simulatorPresentation'

const props = defineProps<{
  plan: FirewallProcessingPlan
  snapshot: FirewallSnapshot
  result: FirewallSimulationResult | null
}>()
const root = useTemplateRef<HTMLElement>('root')
const afterCollections = useTemplateRef<{ $el: HTMLDetailsElement }>('afterCollections')
const {
  afterCollectionsOpen,
  search,
  openCollections,
  normalizedSearch,
  collections,
  visibleCollections,
  sections,
  ipGroupsById,
  decisionEntry,
  descriptions,
  setCollectionOpen,
  collectionState,
  ruleTrace,
} = useSimulatorProcessing(
  () => props.plan,
  () => props.snapshot,
  () => props.result,
)
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
    summary = afterCollections.value?.$el.querySelector<HTMLElement>('summary')
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
            class="w-full"
          />
        </UFormField>
        <UButton
          v-if="search !== ''"
          color="neutral"
          variant="ghost"
          class="shrink-0"
          @click="clearSearch"
          >Clear search</UButton
        >
      </div>
      <p aria-live="polite" aria-atomic="true" class="text-xs text-muted">
        {{ visibleCollections.length }} of {{ collections.length }} collections. Processing
        positions stay unchanged when filtering.
      </p>
    </div>

    <AppDisclosure title="Before collections: threat intelligence">
      <div class="space-y-2 text-sm text-muted">
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
    </AppDisclosure>

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
            <AppDisclosure
              :data-collection-id="collection.id"
              :open="openCollections.has(collection.id)"
              :title="collection.name"
              @update:open="setCollectionOpen(collection.id, $event)"
            >
              <template #summary>
                <span class="inline-flex w-[calc(100%-1.5rem)] items-start gap-2 align-top">
                  <span class="shrink-0 text-sm text-muted tabular-nums"
                    ><span class="sr-only">Processing position </span>{{ ordinal }}.</span
                  >
                  <span class="min-w-0 flex-1 space-y-1">
                    <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span class="font-mono font-semibold break-words">{{ collection.name }}</span>
                      <AppStatusLabel
                        :tone="collection.action === 'Deny' ? 'error' : 'success'"
                        :label="collection.action"
                      />
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
                    <span v-if="result" class="block text-xs font-medium">
                      <AppStatusLabel
                        :tone="
                          collectionState(collection.id) === 'Unresolved' ? 'warning' : 'neutral'
                        "
                        :label="collectionState(collection.id)"
                      />
                    </span>
                  </span>
                </span>
              </template>
              <div v-if="openCollections.has(collection.id)" class="space-y-3">
                <p class="text-xs text-muted">{{ collection.reason }}</p>
                <ol class="divide-y divide-default">
                  <li
                    v-for="(rule, index) in collection.rules"
                    :key="`${rule.name}-${index}`"
                    class="space-y-2 py-3 first:pt-0 last:pb-0"
                  >
                    <p class="font-mono text-sm font-medium break-words">
                      {{ index + 1 }}. {{ rule.name }}
                    </p>
                    <dl class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                      <div>
                        <dt class="text-muted">Source</dt>
                        <dd class="mt-1 font-mono break-words">
                          {{ simulatorAddresses(rule, ipGroupsById, 'source') }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-muted">Destination</dt>
                        <dd class="mt-1 font-mono break-words">
                          {{ simulatorAddresses(rule, ipGroupsById, 'destination') }}
                        </dd>
                      </div>
                      <div>
                        <dt class="text-muted">Protocol / port</dt>
                        <dd class="mt-1 font-mono break-words">{{ simulatorProtocols(rule) }}</dd>
                      </div>
                      <div v-if="rule.ruleType === 'DNAT'" class="sm:col-span-3">
                        <dt class="text-muted">Translated destination</dt>
                        <dd class="mt-1 font-mono break-words">
                          {{
                            simulatorDisplayValue(
                              rule.properties['translatedAddress'] ??
                                rule.properties['translatedFqdn'],
                            )
                          }}:{{ simulatorDisplayValue(rule.properties['translatedPort']) }}
                        </dd>
                      </div>
                    </dl>
                    <p
                      v-for="(entry, traceIndex) in ruleTrace(collection.id, rule)"
                      :key="traceIndex"
                      class="space-x-1 text-sm"
                    >
                      <AppStatusLabel
                        :tone="entry.status === 'unknown' ? 'warning' : 'neutral'"
                        :label="SIMULATOR_TRACE_LABELS[entry.status]"
                      />
                      <span class="text-muted">{{
                        simulatorReason(entry.reason, plan.missingIpGroupIds)
                      }}</span>
                    </p>
                    <p
                      v-if="result && ruleTrace(collection.id, rule).length === 0"
                      class="text-xs text-muted"
                    >
                      Not reached. Processing stopped before this rule.
                    </p>
                    <AppDisclosure title="Rule JSON">
                      <AppRawRecord
                        :label="rule.name"
                        :value="JSON.stringify(rule.properties, null, 2)"
                      />
                    </AppDisclosure>
                  </li>
                </ol>
              </div>
            </AppDisclosure>
          </li>
        </ol>
      </section>
    </template>

    <AppDisclosure
      ref="afterCollections"
      v-model:open="afterCollectionsOpen"
      title="After collections: infrastructure and default deny"
    >
      <p class="max-w-3xl text-sm text-muted">
        Unmatched application traffic can reach Azure’s built-in infrastructure collection, then
        default deny. IDPS may log in parallel or block after a configured-rule match. Routing, DNS,
        TLS, threat feeds, and established connections can also affect actual traffic.
      </p>
    </AppDisclosure>
  </div>
</template>
