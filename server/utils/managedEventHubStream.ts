import type { ReceivedEventData } from "@azure/event-hubs";
import type { ServerResponse } from "node:http";

import {
  MANAGED_EVENT_HUB_LOOKBACK_MINUTES,
  type ManagedEventHubLookbackMinutes,
  type ManagedEventHubStreamEnvelope,
  type ManagedEventHubStreamRequest,
} from "../../shared/types/managedEventHub";

type ManagedEventHubReceivedEvent = Pick<
  ReceivedEventData,
  "body" | "enqueuedTimeUtc" | "sequenceNumber"
> &
  Partial<Pick<ReceivedEventData, "offset">>;

export interface ManagedEventHubClient {
  close(): Promise<void>;
  subscribe(
    handlers: {
      processEvents(
        events: readonly ManagedEventHubReceivedEvent[],
        context: { partitionId: string },
      ): Promise<void>;
      processError(error: unknown): Promise<void>;
    },
    options: {
      maxBatchSize: number;
      maxWaitTimeInSeconds: number;
      startPosition: { enqueuedOn: Date };
    },
  ): ManagedEventHubSubscription;
}

export interface ManagedEventHubSubscription {
  close(): Promise<void>;
}

interface ManagedEventHubStreamOptions {
  client: ManagedEventHubClient;
  request: ManagedEventHubStreamRequest;
  sessionExpiresAt: number;
  revalidateSession: () => Promise<boolean>;
  signal?: AbortSignal;
  heartbeatIntervalMs?: number;
  sessionCheckIntervalMs?: number;
  now?: () => number;
}

const textEncoder = new TextEncoder();

function containsControlCharacter(value: string) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

function waitForResponseDrain(response: ServerResponse) {
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.off("close", onClose);
      response.off("drain", onDrain);
      response.off("error", onError);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Managed Event Hub response closed"));
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    response.once("close", onClose);
    response.once("drain", onDrain);
    response.once("error", onError);
  });
}

export async function pipeManagedEventHubStream(
  response: ServerResponse,
  stream: ReadableStream<Uint8Array>,
) {
  const reader = stream.getReader();
  try {
    while (!response.destroyed && !response.writableEnded) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!response.write(value)) {
        await waitForResponseDrain(response);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (!response.destroyed && !response.writableEnded) {
    response.end();
  }
}

export function validateManagedEventHubStreamRequest(
  value: unknown,
): value is ManagedEventHubStreamRequest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("consumerGroup") || !keys.includes("lookbackMinutes")) {
    return false;
  }

  const request = value as Record<string, unknown>;
  const consumerGroup = request.consumerGroup;
  return (
    typeof consumerGroup === "string" &&
    consumerGroup === consumerGroup.trim() &&
    consumerGroup.length > 0 &&
    consumerGroup.length <= 256 &&
    !containsControlCharacter(consumerGroup) &&
    typeof request.lookbackMinutes === "number" &&
    MANAGED_EVENT_HUB_LOOKBACK_MINUTES.includes(
      request.lookbackMinutes as ManagedEventHubLookbackMinutes,
    )
  );
}

export function encodeManagedEventHubEnvelope(envelope: ManagedEventHubStreamEnvelope) {
  return textEncoder.encode(`${JSON.stringify(envelope)}\n`);
}

export function createManagedEventHubStream({
  client,
  request,
  sessionExpiresAt,
  revalidateSession,
  signal,
  heartbeatIntervalMs = 15_000,
  sessionCheckIntervalMs = 30_000,
  now = Date.now,
}: ManagedEventHubStreamOptions) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let subscription: ManagedEventHubSubscription | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let sessionTimer: ReturnType<typeof setInterval> | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let demandResolve: (() => void) | null = null;
  let closed = false;
  let cleanupPromise: Promise<void> | null = null;
  let writeChain = Promise.resolve();
  let heartbeatPending = false;
  let sessionCheckPending = false;

  const releaseDemand = () => {
    demandResolve?.();
    demandResolve = null;
  };

  const waitForDemand = async () => {
    while (!closed && controller?.desiredSize !== null && (controller?.desiredSize ?? 0) <= 0) {
      await new Promise<void>((resolve) => {
        demandResolve = resolve;
      });
    }
  };

  const cleanup = () => {
    if (cleanupPromise) {
      return cleanupPromise;
    }

    closed = true;
    releaseDemand();
    signal?.removeEventListener("abort", cleanup);
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
    }
    if (sessionTimer) {
      clearInterval(sessionTimer);
    }
    if (expiryTimer) {
      clearTimeout(expiryTimer);
    }

    const activeSubscription = subscription;
    subscription = null;
    cleanupPromise = (async () => {
      await Promise.allSettled([activeSubscription?.close(), client.close()]);
      try {
        controller?.close();
      } catch {
        // Stream may already be cancelled by its consumer.
      }
    })();
    return cleanupPromise;
  };

  const write = (envelope: ManagedEventHubStreamEnvelope, waitForBackpressure = true) => {
    const encoded = encodeManagedEventHubEnvelope(envelope);
    const pendingWrite = writeChain.then(async () => {
      if (closed || !controller) {
        throw new Error("Managed Event Hub stream is closed");
      }
      controller.enqueue(encoded);
      if (waitForBackpressure) {
        await waitForDemand();
      }
    });
    writeChain = pendingWrite.catch(() => undefined);
    return pendingWrite;
  };

  const terminateForExpiredSession = async () => {
    if (closed) {
      return;
    }
    try {
      controller?.enqueue(
        encodeManagedEventHubEnvelope({ type: "error", message: "Session expired" }),
      );
    } catch {
      // Consumer closure is handled by cleanup.
    }
    await cleanup();
  };

  const stream = new ReadableStream<Uint8Array>(
    {
      start(streamController) {
        controller = streamController;
        if (signal?.aborted) {
          void cleanup();
          return;
        }
        signal?.addEventListener("abort", cleanup, { once: true });

        try {
          subscription = client.subscribe(
            {
              async processEvents(events, context) {
                if (events.length === 0 || closed) {
                  return;
                }
                await write({
                  type: "events",
                  events: events.map((event) => ({
                    body: event.body,
                    enqueuedTimeUtc: event.enqueuedTimeUtc.toISOString(),
                    partitionId: context.partitionId,
                    sequenceNumber: event.sequenceNumber,
                    offset: event.offset === undefined ? undefined : String(event.offset),
                  })),
                });
              },
              async processError() {
                if (closed) {
                  return;
                }
                try {
                  await write({ type: "error", message: "Event Hub receiver error" });
                } catch {
                  await cleanup();
                }
              },
            },
            {
              maxBatchSize: 1,
              maxWaitTimeInSeconds: 5,
              startPosition: {
                enqueuedOn: new Date(now() - request.lookbackMinutes * 60_000),
              },
            },
          );
        } catch {
          void write({ type: "error", message: "Event Hub receiver error" }, false).finally(
            cleanup,
          );
          return;
        }

        heartbeatTimer = setInterval(() => {
          if (heartbeatPending) {
            return;
          }
          heartbeatPending = true;
          void write({ type: "heartbeat" })
            .catch(() => cleanup())
            .finally(() => {
              heartbeatPending = false;
            });
        }, heartbeatIntervalMs);
        sessionTimer = setInterval(() => {
          if (sessionCheckPending) {
            return;
          }
          sessionCheckPending = true;
          void revalidateSession()
            .then((valid) => (valid ? undefined : terminateForExpiredSession()))
            .catch(() => terminateForExpiredSession())
            .finally(() => {
              sessionCheckPending = false;
            });
        }, sessionCheckIntervalMs);
        expiryTimer = setTimeout(
          () => void terminateForExpiredSession(),
          Math.max(0, sessionExpiresAt * 1_000 - now()),
        );
      },
      pull() {
        releaseDemand();
      },
      async cancel() {
        await cleanup();
      },
    },
    { highWaterMark: 1 },
  );

  return { cleanup, stream };
}
