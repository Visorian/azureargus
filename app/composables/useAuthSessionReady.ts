let pendingSession: Promise<void> | null = null

export function useAuthSessionReady(): { load: () => Promise<void> } {
  const ready = useState('auth-session-ready', () => false)
  const auth = useOidcAuth()

  async function load(): Promise<void> {
    if (ready.value) {
      return
    }
    if (pendingSession !== null) {
      await pendingSession
      return
    }

    pendingSession = auth.fetch()
    try {
      await pendingSession
      ready.value = true
    } finally {
      pendingSession = null
    }
  }

  return { load }
}
