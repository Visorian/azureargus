<script setup lang="ts">
import type { UiTone } from '~/types/ui'

withDefaults(defineProps<{ title: string; description?: string; tone?: UiTone; icon?: string }>(), {
  tone: 'neutral',
  description: undefined,
  icon: undefined,
})
defineSlots<{ default?: () => unknown; title?: () => unknown; actions?: () => unknown }>()
</script>

<template>
  <section
    class="status-panel"
    :data-tone="tone"
    :role="tone === 'error' ? 'alert' : tone === 'warning' ? 'status' : undefined"
  >
    <div class="status-heading">
      <AppStatusIcon :tone="tone" :icon="icon" class="size-5 shrink-0" />
      <slot name="title"
        ><strong>{{ title }}</strong></slot
      >
    </div>
    <p v-if="description" class="status-description">{{ description }}</p>
    <div v-if="$slots['default']" class="status-description"><slot /></div>
    <div v-if="$slots['actions']" class="status-actions"><slot name="actions" /></div>
  </section>
</template>
