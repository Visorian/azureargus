<script setup lang="ts">
defineProps<{ title: string; description?: string }>()
defineSlots<{ default: () => unknown }>()
</script>

<template>
  <section class="settings-section">
    <header>
      <h3 class="settings-section-title">{{ title }}</h3>
      <p v-if="description" class="settings-description">{{ description }}</p>
    </header>
    <slot />
  </section>
</template>
