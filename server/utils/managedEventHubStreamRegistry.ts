interface ManagedEventHubStreamRegistration {
  close(): Promise<void>;
  owner: symbol;
}

const activeStreams = new Map<string, ManagedEventHubStreamRegistration>();
const registrationQueues = new Map<string, Promise<void>>();

export async function registerManagedEventHubStream(
  sessionId: string,
  close: () => Promise<void>,
) {
  const owner = Symbol(sessionId);
  const previousRegistration = registrationQueues.get(sessionId) ?? Promise.resolve();
  const registration = previousRegistration.catch(() => undefined).then(async () => {
    await activeStreams.get(sessionId)?.close();
    activeStreams.set(sessionId, { close, owner });
  });
  registrationQueues.set(sessionId, registration);

  try {
    await registration;
  } finally {
    if (registrationQueues.get(sessionId) === registration) {
      registrationQueues.delete(sessionId);
    }
  }

  return () => {
    if (activeStreams.get(sessionId)?.owner === owner) {
      activeStreams.delete(sessionId);
    }
  };
}
