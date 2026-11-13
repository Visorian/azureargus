<script setup lang="ts">
const colorMode = useColorMode()
const label = computed(() =>
  colorMode.value === 'dark' ? 'Switch to light mode' : 'Switch to dark mode',
)
</script>

<template>
  <UTooltip :text="label">
    <UColorModeButton :aria-label="label" class="app-icon-button" />
  </UTooltip>
</template>
