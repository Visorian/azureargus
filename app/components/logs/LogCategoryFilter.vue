<script setup lang="ts">
import { onClickOutside, useMediaQuery } from '@vueuse/core'

import { logCategoryLabel } from '~/utils/logFilterPresentation'

const selected = defineModel<string[]>({ required: true })
defineProps<{ categories: string[] }>()
const panel = useTemplateRef('panel')
const trigger = useTemplateRef('trigger')
const phone = useMediaQuery('(max-width: 640px)')
function close(restore = true) {
  if (panel.value) {
    panel.value.open = false
  }
  if (restore) {
    trigger.value?.focus({ preventScroll: true })
  }
}
function leave(event: FocusEvent) {
  if (
    !phone.value &&
    event.relatedTarget instanceof Node &&
    !panel.value?.contains(event.relatedTarget)
  ) {
    close(false)
  }
}
onClickOutside(panel, () => close(false))
function toggle(value: string, checked: boolean) {
  selected.value = checked
    ? [...selected.value, value]
    : selected.value.filter((item) => item !== value)
}
</script>

<template>
  <details
    ref="panel"
    name="log-filter-popovers"
    class="filter-categories"
    @focusout="leave"
    @keydown.esc.stop.prevent="close()"
  >
    <summary ref="trigger" class="filter-category-trigger">
      Categories<span class="filter-count" :aria-hidden="selected.length === 0">{{
        selected.length ? `(${selected.length})` : ''
      }}</span
      ><UIcon name="i-lucide-chevron-down" class="size-4" />
    </summary>
    <div class="filter-popover filter-category-panel">
      <fieldset class="space-y-2">
        <legend class="sr-only">Categories</legend>
        <UCheckbox
          v-for="category in categories"
          :key="category"
          :model-value="selected.includes(category)"
          :label="logCategoryLabel(category)"
          @update:model-value="toggle(category, $event === true)"
        />
      </fieldset>
      <div class="flex justify-end">
        <UButton label="Done" color="neutral" variant="outline" @click="close()" />
      </div>
    </div>
  </details>
</template>
