<script setup lang="ts">
import { useClipboardFeedback } from '~/composables/useClipboardFeedback'

withDefaults(defineProps<{ value: string; label?: string }>(), { label: 'Raw record' })
const { copy, announcement } = useClipboardFeedback()
</script>

<template>
  <section class="raw-record">
    <div class="raw-record-header">
      <h3>{{ label }}</h3>
      <UButton color="neutral" variant="outline" icon="i-lucide-copy" @click="copy(value)">
        Copy raw
      </UButton>
    </div>
    <p class="sr-only" role="status">{{ announcement }}</p>
    <pre tabindex="0" :aria-label="label">{{ value }}</pre>
  </section>
</template>
