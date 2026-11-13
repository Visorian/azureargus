<script setup lang="ts" generic="T extends string">
import type { SegmentedControlItem } from '~/types/ui'

const model = defineModel<T>({ required: true })
defineProps<{
  label: string
  items: readonly SegmentedControlItem<T>[]
}>()
const name = useId()
</script>

<template>
  <fieldset class="segmented-control">
    <legend class="sr-only">{{ label }}</legend>
    <label
      v-for="item in items"
      :key="item.value"
      class="segmented-choice"
      :data-selected="model === item.value"
      :data-disabled="item.disabled || undefined"
      :title="item.description"
    >
      <input
        v-model="model"
        type="radio"
        :name="name"
        :value="item.value"
        :disabled="item.disabled"
        :aria-description="item.description"
      />
      <UIcon v-if="item.icon" :name="item.icon" class="size-4" />
      <span>{{ item.label }}</span>
    </label>
  </fieldset>
</template>
