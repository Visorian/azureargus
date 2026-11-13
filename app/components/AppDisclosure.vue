<script setup lang="ts">
withDefaults(defineProps<{ title?: string; open?: boolean }>(), { title: undefined, open: false })
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
defineSlots<{ default?: () => unknown; summary?: () => unknown }>()

function onToggle(event: Event) {
  if (event.target instanceof HTMLDetailsElement) {
    emit('update:open', event.target.open)
  }
}
</script>

<template>
  <details class="app-disclosure" :open="open" @toggle="onToggle">
    <summary>
      <slot name="summary">{{ title }}</slot>
    </summary>
    <div class="disclosure-body"><slot /></div>
  </details>
</template>
