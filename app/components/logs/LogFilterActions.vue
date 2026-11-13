<script setup lang="ts">
const props = withDefaults(defineProps<{ resetDisabled?: boolean }>(), { resetDisabled: false })
const emit = defineEmits<{ reset: [] }>()
</script>

<template>
  <UButton
    color="neutral"
    variant="outline"
    icon="i-lucide-rotate-ccw"
    label="Reset"
    :aria-disabled="resetDisabled"
    data-testid="log-filter-actions"
    @click="!props.resetDisabled && emit('reset')"
  />
</template>
