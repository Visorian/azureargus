<script setup lang="ts">
defineProps<{
  applyDisabled: boolean
  applyLoading: boolean
  showApply: boolean
}>()

const emit = defineEmits<{
  apply: []
  reset: []
}>()
</script>

<template>
  <div class="col-span-full flex shrink-0 items-center gap-2" data-testid="log-filter-actions">
    <UButton
      v-if="showApply"
      icon="i-lucide-filter"
      label="Apply filters"
      color="neutral"
      variant="outline"
      class="touch-control"
      :disabled="applyDisabled"
      :loading="applyLoading"
      @click="emit('apply')"
    />
    <UButton
      color="neutral"
      variant="ghost"
      icon="i-lucide-rotate-ccw"
      label="Reset"
      class="touch-control"
      @click="emit('reset')"
    />
  </div>
</template>
