import type { Ref } from 'vue'

interface ClipboardMessages {
  success?: string | false
  error?: string | false
}

interface ClipboardFeedback {
  announcement: Readonly<Ref<string>>
  copy: (value: string, messages?: ClipboardMessages) => Promise<boolean>
}

export function useClipboardFeedback(): ClipboardFeedback {
  const toast = useToast()
  const announcement = ref('')

  async function copy(value: string, messages: ClipboardMessages = {}): Promise<boolean> {
    announcement.value = ''
    try {
      await navigator.clipboard.writeText(value)
      announcement.value =
        typeof messages.success === 'string' ? messages.success : 'Copied to clipboard'
      if (messages.success !== false) {
        toast.add({ title: announcement.value, color: 'success' })
      }
      return true
    } catch {
      if (messages.error !== false) {
        announcement.value = messages.error ?? 'Copy failed. Select the text and copy it manually.'
        toast.add({
          title: announcement.value,
          color: 'error',
        })
      }
      return false
    }
  }

  return { copy, announcement }
}
