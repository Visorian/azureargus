import type { EventHubConsumerClient } from "@azure/event-hubs";

import {
  DEFAULT_BUFFER_SIZE,
  getEventHubLookbackStart,
  getEventHubName,
  getRawLogBufferSize,
  parseEventHubConnectionString,
  validateEventHubConnectionForm,
  type EventHubConnectionForm,
} from "./useEventHubConnection";
import { expandAzureMonitorRecords, normalizeFirewallLogRecord } from "./useFirewallLogParser";
import { createLogBatcher } from "./useLogBatcher";
import type { FirewallLogRecord } from "~/types/firewall";

type ReceiverStatus = "idle" | "connecting" | "connected" | "paused" | "error";
type ReceiverSubscription = { close(): Promise<void> };
export interface EventHubLogEvent {
  body: unknown;
  enqueuedTimeUtc?: Date | string;
  sequenceNumber?: number | string;
}

let client: EventHubConsumerClient | null = null;
let subscription: ReceiverSubscription | null = null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Event Hub receiver error.";
}

function eventToFirewallLogs(
  event: EventHubLogEvent,
  partitionId: string,
  baseIndex: number,
): FirewallLogRecord[] {
  return expandAzureMonitorRecords(event.body).map((raw, index) =>
    normalizeFirewallLogRecord({
      raw,
      enqueuedTimeUtc: event.enqueuedTimeUtc,
      partitionId,
      sequenceNumber: event.sequenceNumber,
      index: baseIndex + index,
    }),
  );
}

export function eventsToFirewallLogs(
  events: readonly EventHubLogEvent[],
  partitionId: string,
  startIndex: number,
) {
  const records: FirewallLogRecord[] = [];
  let nextIndex = startIndex;

  for (const event of events) {
    const eventRecords = eventToFirewallLogs(event, partitionId, nextIndex);
    nextIndex += eventRecords.length;
    records.push(...eventRecords);
  }

  return {
    nextIndex,
    records,
  };
}

export function useEventHubReceiver() {
  const status = useState<ReceiverStatus>("event-hub-status", () => "idle");
  const errors = useState<string[]>("event-hub-errors", () => []);
  const receivedCount = useState("event-hub-received-count", () => 0);
  const lastReceivedAt = useState<string | null>("event-hub-last-received-at", () => null);
  const visibleLimit = useState("event-hub-visible-limit", () => DEFAULT_BUFFER_SIZE);
  const rawBufferSize = computed(() => getRawLogBufferSize(visibleLimit.value));
  const buffer = useBoundedLogBuffer<FirewallLogRecord>("firewall-log-records", rawBufferSize);
  const logHistoryPersistence = useLogHistoryPersistence();
  const paused = computed(() => status.value === "paused");
  let nextRecordIndex = receivedCount.value;
  const batcher = createLogBatcher<FirewallLogRecord>({
    onFlush: (records) => {
      buffer.pushMany(records);
      receivedCount.value += records.length;
      lastReceivedAt.value = records.at(-1)?.enqueuedTimeUtc ?? new Date().toISOString();
      logHistoryPersistence.queueRecords(records);
    },
  });

  async function disconnect() {
    batcher.flush();
    await logHistoryPersistence.flush();
    logHistoryPersistence.clearQueueIfDisabled();

    if (subscription) {
      await subscription.close();
      subscription = null;
    }

    if (client) {
      await client.close();
      client = null;
    }

    if (status.value !== "error") {
      status.value = "idle";
    }
  }

  async function connect(form: EventHubConnectionForm) {
    const validationErrors = validateEventHubConnectionForm(form);
    if (validationErrors.length > 0) {
      errors.value = validationErrors;
      return false;
    }

    await disconnect();
    status.value = "connecting";
    errors.value = [];
    visibleLimit.value = form.bufferSize;

    try {
      const { EventHubConsumerClient } = await import("@azure/event-hubs");
      const eventHubName = getEventHubName(form);
      client =
        eventHubName && !parseEventHubConnectionString(form.connectionString).has("entitypath")
          ? new EventHubConsumerClient(
              form.consumerGroup.trim(),
              form.connectionString.trim(),
              eventHubName,
            )
          : new EventHubConsumerClient(form.consumerGroup.trim(), form.connectionString.trim());

      subscription = client.subscribe(
        {
          processEvents: async (events, context) => {
            if (status.value === "paused") {
              return;
            }

            const result = eventsToFirewallLogs(events, context.partitionId, nextRecordIndex);
            nextRecordIndex = result.nextIndex;
            batcher.pushMany(result.records);
          },
          processError: async (error) => {
            errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
            status.value = "error";
          },
        },
        {
          startPosition: {
            enqueuedOn: getEventHubLookbackStart(form.lookbackMinutes),
          },
        },
      );

      status.value = "connected";
      return true;
    } catch (error: unknown) {
      errors.value = [getErrorMessage(error)];
      status.value = "error";
      return false;
    }
  }

  function pause() {
    if (status.value === "connected") {
      status.value = "paused";
    }
  }

  function resume() {
    if (status.value === "paused") {
      status.value = "connected";
    }
  }

  function clear() {
    batcher.clear();
    logHistoryPersistence.clearQueueIfDisabled();
    buffer.clear();
    receivedCount.value = 0;
    nextRecordIndex = 0;
    lastReceivedAt.value = null;
  }

  return {
    status,
    errors,
    logs: buffer.items,
    visibleLimit,
    receivedCount,
    lastReceivedAt,
    paused,
    connect,
    disconnect,
    pause,
    resume,
    clear,
  };
}
