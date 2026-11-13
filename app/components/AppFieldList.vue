<script setup lang="ts">
import { useClipboardFeedback } from '~/composables/useClipboardFeedback'
import type { DisplayField } from '~/types/ui'

withDefaults(defineProps<{ fields: readonly DisplayField[]; copyable?: boolean }>(), {
  copyable: false,
})
const { copy, announcement } = useClipboardFeedback()
</script>

<template>
  <dl class="app-field-list">
    <div v-for="field in fields" :key="field.label">
      <dt>{{ field.label }}</dt>
      <dd class="field-value">
        <span :class="{ 'font-mono': field.mono }">{{ field.value || '—' }}</span>
        <UTooltip v-if="copyable && field.value" :text="`Copy ${field.label}`">
          <UButton
            color="neutral"
            variant="ghost"
            icon="i-lucide-copy"
            :aria-label="`Copy ${field.label}`"
            @click="copy(field.value)"
          />
        </UTooltip>
      </dd>
    </div>
  </dl>
  <p class="sr-only" role="status">{{ announcement }}</p>
</template>
