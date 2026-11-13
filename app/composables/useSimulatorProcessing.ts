import type { ComputedRef, Ref } from 'vue'

import type {
  FirewallProcessingPlan,
  FirewallSimulationResult,
  FirewallSnapshot,
  ProcessingCollection,
  SimulatorIpGroup,
  SimulatorRule,
  SimulationTraceEntry,
  SimulatorRuleType,
} from '#shared/types/firewallSimulator'
import { simulatorCollectionState } from '~/utils/simulatorPresentation'

interface ProcessingItem {
  collection: ProcessingCollection
  ordinal: number
  searchText: string
}
interface SimulatorProcessingState {
  afterCollectionsOpen: Ref<boolean>
  search: Ref<string>
  openCollections: Ref<Set<string>>
  normalizedSearch: ComputedRef<string>
  collections: ComputedRef<ProcessingItem[]>
  visibleCollections: ComputedRef<ProcessingItem[]>
  sections: ComputedRef<{ type: SimulatorRuleType; total: number; items: ProcessingItem[] }[]>
  traceByCollection: ComputedRef<Map<string, SimulationTraceEntry[]>>
  ipGroupsById: ComputedRef<Map<string, SimulatorIpGroup>>
  decisionEntry: ComputedRef<SimulationTraceEntry | undefined>
  descriptions: Record<SimulatorRuleType, string>
  setCollectionOpen: (id: string, open: boolean) => void
  collectionState: (id: string) => string
  ruleTrace: (id: string, rule: SimulatorRule) => SimulationTraceEntry[]
}

export function useSimulatorProcessing(
  getPlan: () => FirewallProcessingPlan,
  getSnapshot: () => FirewallSnapshot,
  getResult: () => FirewallSimulationResult | null,
): SimulatorProcessingState {
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
    getPlan().collections.map((collection, index) => ({
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
    for (const entry of getResult()?.trace ?? []) {
      const collection = entries.get(entry.collectionId) ?? []
      collection.push(entry)
      entries.set(entry.collectionId, collection)
    }
    return entries
  })
  const ipGroupsById = computed(
    () => new Map(getSnapshot().ipGroups.map((group) => [group.id.toLowerCase(), group])),
  )
  const decisionEntry = computed(() => {
    const result = getResult()
    const trace = result?.trace ?? []
    return (
      (result?.verdict === 'Indeterminate'
        ? trace.find((entry) => entry.status === 'unknown')
        : undefined) ??
      trace.find((entry) => entry.status === 'match') ??
      trace.at(-1)
    )
  })

  watch(
    () => getPlan(),
    () => {
      search.value = ''
      openCollections.value = new Set()
      afterCollectionsOpen.value = false
    },
  )
  watch(
    () => getResult(),
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

  function collectionState(id: string): string {
    return simulatorCollectionState(traceByCollection.value.get(id))
  }
  function ruleTrace(id: string, rule: SimulatorRule): SimulationTraceEntry[] {
    return traceByCollection.value.get(id)?.filter((entry) => entry.ruleName === rule.name) ?? []
  }
  function setCollectionOpen(id: string, open: boolean) {
    if (open) {
      openCollections.value.add(id)
    } else {
      openCollections.value.delete(id)
    }
  }
  return {
    afterCollectionsOpen,
    search,
    openCollections,
    normalizedSearch,
    collections,
    visibleCollections,
    sections,
    traceByCollection,
    ipGroupsById,
    decisionEntry,
    descriptions,
    setCollectionOpen,
    collectionState,
    ruleTrace,
  }
}
