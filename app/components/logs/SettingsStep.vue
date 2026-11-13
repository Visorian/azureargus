<script setup lang="ts">
defineProps<{ number: number; title: string; description: string }>()
defineSlots<{ default: () => unknown }>()
const titleElement = useTemplateRef<HTMLElement>('titleElement')
defineExpose({ focus: () => titleElement.value?.focus() })
</script>

<template>
  <li class="settings-step">
    <span class="settings-step-number" aria-hidden="true">{{ number }}</span>
    <div class="settings-step-body">
      <header>
        <h4 ref="titleElement" tabindex="-1" class="settings-step-title">{{ title }}</h4>
        <p class="settings-description">{{ description }}</p>
      </header>
      <slot />
    </div>
  </li>
</template>
