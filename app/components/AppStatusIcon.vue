<script setup lang="ts">
import type { UiTone } from '~/types/ui'

defineProps<{ tone: UiTone; icon?: string }>()
</script>

<template>
  <UIcon v-if="icon" :name="icon" />
  <UIcon v-else-if="tone === 'success'" name="i-lucide-circle-check" />
  <UIcon v-else-if="tone === 'error'" name="i-lucide-circle-x" />
  <UIcon v-else-if="tone === 'warning'" name="i-lucide-triangle-alert" />
  <UIcon v-else name="i-lucide-info" />
</template>
