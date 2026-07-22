import type { ManagedEventHubStreamEnvelope } from "#shared/types/managedEventHub";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseManagedEventHubEnvelope(value: string): ManagedEventHubStreamEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Managed Event Hub stream returned invalid JSON");
  }

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    throw new Error("Managed Event Hub stream returned invalid message");
  }
  if (parsed.type === "heartbeat") {
    return { type: "heartbeat" };
  }
  if (parsed.type === "caught-up") {
    return { type: "caught-up" };
  }
  if (
    parsed.type === "error" &&
    (parsed.message === "Event Hub receiver error" || parsed.message === "Session expired")
  ) {
    return { type: "error", message: parsed.message };
  }
  if (parsed.type === "events" && Array.isArray(parsed.events)) {
    const events = parsed.events.map((event) => {
      if (
        !isRecord(event) ||
        typeof event.enqueuedTimeUtc !== "string" ||
        typeof event.partitionId !== "string" ||
        typeof event.sequenceNumber !== "number" ||
        (event.offset !== undefined && typeof event.offset !== "string") ||
        (event.applicationProperties !== undefined && !isRecord(event.applicationProperties))
      ) {
        throw new Error("Managed Event Hub stream returned invalid event");
      }
      return {
        body: event.body,
        enqueuedTimeUtc: event.enqueuedTimeUtc,
        offset: event.offset,
        partitionId: event.partitionId,
        sequenceNumber: event.sequenceNumber,
        applicationProperties: event.applicationProperties,
      };
    });
    return { type: "events", events };
  }

  throw new Error("Managed Event Hub stream returned unknown message");
}

export async function consumeManagedEventHubStream(
  stream: ReadableStream<Uint8Array>,
  onEnvelope: (envelope: ManagedEventHubStreamEnvelope) => void,
  signal: AbortSignal,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  const cancel = () => void reader.cancel();
  signal.addEventListener("abort", cancel, { once: true });

  try {
    while (!signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffered += decoder.decode(value, { stream: true });
      let newlineIndex = buffered.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffered.slice(0, newlineIndex).trim();
        buffered = buffered.slice(newlineIndex + 1);
        if (line) {
          onEnvelope(parseManagedEventHubEnvelope(line));
        }
        newlineIndex = buffered.indexOf("\n");
      }
    }

    buffered += decoder.decode();
    if (!signal.aborted && buffered.trim()) {
      onEnvelope(parseManagedEventHubEnvelope(buffered.trim()));
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}
