interface ManagedEventHubStreamRegistration {
  close(): Promise<void>
  owner: symbol
}

const activeStreams = new Map<string, ManagedEventHubStreamRegistration>()
const registrationQueues = new Map<string, Promise<void>>()

async function activateAfter(
  previousRegistration: Promise<void>,
  sessionId: string,
  registration: ManagedEventHubStreamRegistration,
) {
  try {
    await previousRegistration
  } catch {
    // A failed earlier registration must not block this one.
  }
  try {
    await activeStreams.get(sessionId)?.close()
  } catch {
    // Failed cleanup must not prevent the replacement stream from becoming active.
  }
  activeStreams.set(sessionId, registration)
}

export async function registerManagedEventHubStream(sessionId: string, close: () => Promise<void>) {
  const owner = Symbol(sessionId)
  const previousRegistration = registrationQueues.get(sessionId) ?? Promise.resolve()
  const registration = activateAfter(previousRegistration, sessionId, { close, owner })
  registrationQueues.set(sessionId, registration)

  try {
    await registration
  } finally {
    if (registrationQueues.get(sessionId) === registration) {
      registrationQueues.delete(sessionId)
    }
  }

  return () => {
    if (activeStreams.get(sessionId)?.owner === owner) {
      activeStreams.delete(sessionId)
    }
  }
}
