<script setup lang="ts">
defineProps<{
  title: string
  description: string
}>()

defineSlots<{
  default?: () => unknown
  actions?: () => unknown
}>()
</script>

<template>
  <section class="status-card" aria-labelledby="status-title">
    <div class="status-card-header">
      <h1 id="status-title" class="status-card-title">{{ title }}</h1>
      <p class="status-card-description">{{ description }}</p>
    </div>
    <div v-if="$slots['default']" class="status-card-body">
      <slot />
    </div>
    <div v-if="$slots['actions']" class="status-card-actions">
      <slot name="actions" />
    </div>
  </section>
</template>
