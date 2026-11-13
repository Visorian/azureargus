import type { FormErrorEvent, FormErrorWithId } from '@nuxt/ui'
import type { Ref } from 'vue'

import type { EventHubConnectionForm } from '~/utils/eventHubConnection'

interface EventHubSettingsValidationOptions {
  connectionForm: Readonly<Ref<EventHubConnectionForm>>
  revalidate: () => Promise<readonly FormErrorWithId[]>
}

export function useEventHubSettingsValidation(options: EventHubSettingsValidationOptions): {
  message: Ref<string | null>
  onError: (event: FormErrorEvent) => Promise<void>
  clear: () => void
} {
  const message = ref<string | null>(null)
  let submitted = false

  async function onError(event: FormErrorEvent): Promise<void> {
    submitted = true
    message.value = 'Review the highlighted connection settings.'
    await nextTick()
    const id = event.errors[0]?.id
    const field = id === undefined ? null : document.getElementById(id)
    field?.focus({ preventScroll: true })
    field?.scrollIntoView({ block: 'nearest' })
  }

  watch(
    () => ({ ...options.connectionForm.value }),
    async () => {
      if (!submitted) {
        return
      }
      await nextTick()
      const errors = await options.revalidate()
      if (errors.length === 0) {
        message.value = null
      }
    },
  )

  function clear(): void {
    submitted = false
    message.value = null
  }

  return { message, onError, clear }
}
