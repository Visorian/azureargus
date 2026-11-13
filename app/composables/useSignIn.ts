import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'

export function useSignIn(): {
  error: Ref<string | null>
  pending: Ref<boolean>
  signIn: () => Promise<void>
} {
  const { login } = useOidcAuth()
  const pending = ref(false)
  const error = ref<string | null>(null)

  useEventListener('pageshow', () => {
    pending.value = false
  })

  async function signIn(): Promise<void> {
    if (pending.value) {
      return
    }

    pending.value = true
    error.value = null
    try {
      await login('entra')
    } catch {
      pending.value = false
      error.value = 'Sign-in could not start. Try again.'
    }
  }

  return { error, pending, signIn }
}
