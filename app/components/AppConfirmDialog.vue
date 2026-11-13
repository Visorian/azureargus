<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean
    title: string
    description: string
    confirmLabel: string
    destructive?: boolean
  }>(),
  { destructive: true },
)
const emit = defineEmits<{ 'update:open': [open: boolean]; confirm: [] }>()
const cancelButton = useTemplateRef<{ $el: HTMLButtonElement }>('cancelButton')

function focusCancel(event: Event) {
  event.preventDefault()
  cancelButton.value?.$el.focus()
}

function confirm() {
  emit('confirm')
  emit('update:open', false)
}
</script>

<template>
  <UModal
    class="app-confirm-dialog"
    :open="open"
    :title="title"
    :description="description"
    :content="{ onOpenAutoFocus: focusCancel }"
    @update:open="emit('update:open', $event)"
  >
    <template #footer>
      <UButton
        ref="cancelButton"
        color="neutral"
        variant="outline"
        @click="emit('update:open', false)"
        >Cancel</UButton
      >
      <UButton :color="destructive ? 'error' : 'primary'" @click="confirm">{{
        confirmLabel
      }}</UButton>
    </template>
  </UModal>
</template>
