<script setup lang="ts">
import type { UiTone } from '~/types/ui'

withDefaults(defineProps<{ label: string; tone?: UiTone; icon?: string }>(), {
  tone: 'neutral',
  icon: undefined,
})
</script>

<template>
  <span class="status-label" :data-tone="tone">
    <AppStatusIcon :tone="tone" :icon="icon" class="size-4 shrink-0" />
    <span>{{ label }}</span>
  </span>
</template>
