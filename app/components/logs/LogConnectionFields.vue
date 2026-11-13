<script setup lang="ts">
import type { FirewallLogFilters } from '#shared/types/firewall'

const filters = defineModel<FirewallLogFilters>({ required: true })
const props = defineProps<{ actions: string[]; protocols: string[]; allowCreate?: boolean }>()
const emit = defineEmits<{ createAction: [value: string]; createProtocol: [value: string] }>()
const action = computed({
  get: () => filters.value.action || undefined,
  set: (value: string | undefined) => {
    filters.value.action = value ?? ''
  },
})
const protocol = computed({
  get: () => filters.value.protocol || undefined,
  set: (value: string | undefined) => {
    filters.value.protocol = value ?? ''
  },
})
function createAction(value: string) {
  filters.value.action = value
  emit('createAction', value)
}
function createProtocol(value: string) {
  filters.value.protocol = value
  emit('createProtocol', value)
}
</script>

<template>
  <div class="connection-endpoint">
    <UFormField label="Source address" class="min-w-0 flex-1"
      ><UInput
        v-model="filters.source"
        aria-label="Source address"
        placeholder="Any address"
        class="w-full font-mono"
    /></UFormField>
    <UFormField label="Port" class="connection-port"
      ><UInput
        v-model="filters.sourcePort"
        aria-label="Source port"
        placeholder="Any"
        inputmode="numeric"
        class="w-full font-mono"
    /></UFormField>
  </div>
  <UIcon name="i-lucide-arrow-right" class="connection-arrow" aria-hidden="true" />
  <div class="connection-endpoint">
    <UFormField label="Destination address" class="min-w-0 flex-1"
      ><UInput
        v-model="filters.destination"
        aria-label="Destination address"
        placeholder="Any address"
        class="w-full font-mono"
    /></UFormField>
    <UFormField label="Port" class="connection-port"
      ><UInput
        v-model="filters.destinationPort"
        aria-label="Destination port"
        placeholder="Any"
        inputmode="numeric"
        class="w-full font-mono"
    /></UFormField>
  </div>
  <div class="connection-action-pair">
    <UFormField label="Action" class="min-w-0 flex-1"
      ><USelectMenu
        v-model="action"
        :items="props.actions"
        :create-item="props.allowCreate"
        clear
        placeholder="Any action"
        aria-label="Action filter"
        class="w-full"
        @create="createAction"
    /></UFormField>
    <UFormField label="Protocol" class="min-w-0 flex-1"
      ><USelectMenu
        v-model="protocol"
        :items="props.protocols"
        :create-item="props.allowCreate"
        clear
        placeholder="Any protocol"
        aria-label="Protocol filter"
        class="w-full"
        @create="createProtocol"
    /></UFormField>
  </div>
</template>
