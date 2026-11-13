<script setup lang="ts">
import type { FirewallLogSortKey, FirewallLogSortState } from '#shared/types/firewall'

const props = defineProps<{
  label: string
  sortKey: FirewallLogSortKey
  sort: FirewallLogSortState
  accessibleLabel?: string
}>()
const emit = defineEmits<{ sort: [key: FirewallLogSortKey] }>()
const active = computed(() => props.sort.key === props.sortKey)
</script>

<template>
  <button
    type="button"
    class="log-sort-header"
    :data-active="active"
    :aria-label="accessibleLabel || label"
    @click="emit('sort', sortKey)"
  >
    <span>{{ label }}</span>
    <UIcon v-if="!active" name="i-lucide-arrow-up-down" class="size-3.5 shrink-0" />
    <UIcon
      v-else-if="sort.direction === 'asc'"
      name="i-lucide-arrow-up"
      class="size-3.5 shrink-0"
    />
    <UIcon v-else name="i-lucide-arrow-down" class="size-3.5 shrink-0" />
  </button>
</template>
