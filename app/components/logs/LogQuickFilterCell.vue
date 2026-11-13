<script setup lang="ts">
withDefaults(
  defineProps<{
    value?: string
    label: string
    active?: boolean
    mono?: boolean
    tabbable?: boolean
    display?: string
  }>(),
  {
    value: '',
    active: false,
    mono: false,
    tabbable: true,
    display: undefined,
  },
)
const emit = defineEmits<{ filter: [event: MouseEvent] }>()
defineSlots<{ default?: () => unknown }>()
</script>

<template>
  <span class="log-value" :class="mono && 'font-mono'">
    <span class="min-w-0 truncate" :title="display || value"
      ><slot>{{ display || value || '—' }}</slot></span
    >
    <button
      v-if="value"
      type="button"
      :tabindex="tabbable ? 0 : -1"
      class="log-quick-filter"
      :aria-label="`${active ? 'Remove' : 'Filter by'} ${label}: ${display || value}`"
      :aria-pressed="active"
      :data-filter-label="label"
      @click.stop="emit('filter', $event)"
    >
      <UIcon :name="active ? 'i-lucide-x' : 'i-lucide-filter'" class="size-3.5" />
    </button>
  </span>
</template>
