import {
  DEFAULT_BUFFER_SIZE,
  getEventHubLookbackStart,
  getEventHubName,
  getRawLogBufferSize,
  parseEventHubConnectionString,
  validateEventHubConnectionForm,
  validateEventHubReceiverSettings,
  type EventHubConnectionForm,
} from "./useEventHubConnection";
import { expandAzureMonitorRecords, normalizeFirewallLogRecord } from "./useFirewallLogParser";
import { createLogBatcher } from "./useLogBatcher";
import type { FirewallLogRecord } from "~/types/firewall";
import { consumeManagedEventHubStream } from "~/utils/managedEventHubStream";
import { computed, watch, type Ref } from "vue";

type ReceiverStatus = "idle" | "connecting" | "connected" | "paused" | "error";
const LIVE_TAIL_THRESHOLD_MS = 30_000;

export interface ReceiverSubscription {
  close(): Promise<void>;
}
export interface EventHubLogEvent {
  body: unknown;
  enqueuedTimeUtc?: Date | string;
  sequenceNumber?: number | string;
  offset?: number | string;
}

interface ReceiverPartitionContext {
  partitionId: string;
}

export interface EventHubReceiverClient {
  close(): Promise<void>;
  subscribe(
    handlers: {
      processEvents(
        events: readonly EventHubLogEvent[],
        context: ReceiverPartitionContext,
      ): Promise<void>;
      processError(error: unknown): Promise<void>;
    },
    options: { maxBatchSize: number; startPosition: { enqueuedOn: Date } },
  ): ReceiverSubscription;
}

export type CreateEventHubReceiverClient = (form: EventHubConnectionForm) => EventHubReceiverClient;

export interface EventHubReceiverOptions {
  loadClientFactory?: () => Promise<CreateEventHubReceiverClient>;
  managedFetch?: typeof fetch;
  uiPublishingEnabled?: Readonly<Ref<boolean>>;
}

export interface NormalizedLogBatchSink {
  onClear?(): void;
  onRecords(records: readonly FirewallLogRecord[]): void;
}

export type EventHubConnectionMode = "manual" | "managed";

let client: EventHubReceiverClient | null = null;
let subscription: ReceiverSubscription | null = null;
let connectionGeneration = 0;
let disconnectPromise: Promise<void> | null = null;
let managedStreamController: AbortController | null = null;
let managedStreamPromise: Promise<void> | null = null;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Event Hub receiver error.";
}

function addFilterOption(options: string[], seen: Set<string>, value: string) {
  const trimmed = value.trim();
  const key = trimmed.toLowerCase();
  if (!trimmed || seen.has(key)) {
    return false;
  }

  seen.add(key);
  options.push(trimmed);
  return true;
}

function sortFilterOptions(options: string[]) {
  return options.sort((left, right) =>
    left.localeCompare(right, undefined, { sensitivity: "base" }),
  );
}

async function loadEventHubClientFactory(): Promise<CreateEventHubReceiverClient> {
  const { EventHubConsumerClient } = await import("@azure/event-hubs");

  return (form) => {
    const eventHubName = getEventHubName(form);
    const eventHubClient =
      eventHubName && !parseEventHubConnectionString(form.connectionString).has("entitypath")
        ? new EventHubConsumerClient(
            form.consumerGroup.trim(),
            form.connectionString.trim(),
            eventHubName,
          )
        : new EventHubConsumerClient(form.consumerGroup.trim(), form.connectionString.trim());

    return {
      close: () => eventHubClient.close(),
      subscribe: (handlers, options) => eventHubClient.subscribe(handlers, options),
    };
  };
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
      offset: event.offset,
      index: baseIndex + index,
      eventRecordIndex: index,
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

export function useEventHubReceiver({
  loadClientFactory = loadEventHubClientFactory,
  managedFetch = globalThis.fetch,
  uiPublishingEnabled,
}: EventHubReceiverOptions = {}) {
  const status = useState<ReceiverStatus>("event-hub-status", () => "idle");
  const errors = useState<string[]>("event-hub-errors", () => []);
  const receivedCount = useState("event-hub-received-count", () => 0);
  const latestSourceTimestamp = useState<string | null>(
    "event-hub-latest-source-timestamp",
    () => null,
  );
  const caughtUp = useState("event-hub-caught-up", () => false);
  const visibleLimit = useState("event-hub-visible-limit", () => DEFAULT_BUFFER_SIZE);
  const rawBufferSize = computed(() => getRawLogBufferSize(visibleLimit.value));
  const uiActive = uiPublishingEnabled ?? computed(() => true);
  const buffer = useBoundedLogBuffer<FirewallLogRecord>("firewall-log-records", rawBufferSize, {
    publishingEnabled: uiActive,
    publishedSize: visibleLimit,
  });
  const categoryOptions = useState<string[]>("event-hub-category-options", () => []);
  const actionOptions = useState<string[]>("event-hub-action-options", () => []);
  const protocolOptions = useState<string[]>("event-hub-protocol-options", () => []);
  const categoryKeys = new Set(categoryOptions.value.map((value) => value.toLowerCase()));
  const actionKeys = new Set(actionOptions.value.map((value) => value.toLowerCase()));
  const protocolKeys = new Set(protocolOptions.value.map((value) => value.toLowerCase()));
  const logHistoryPersistence = useLogHistoryPersistence();
  const paused = computed(() => status.value === "paused");
  const normalizedBatchSinks = new Set<NormalizedLogBatchSink>();
  let nextRecordIndex = receivedCount.value;

  function updateUiFilterOptions(records: readonly FirewallLogRecord[], rebuild = false) {
    if (rebuild) {
      categoryOptions.value = [];
      actionOptions.value = [];
      protocolOptions.value = [];
      categoryKeys.clear();
      actionKeys.clear();
      protocolKeys.clear();
    }
    const nextCategories = [...categoryOptions.value];
    const nextActions = [...actionOptions.value];
    const nextProtocols = [...protocolOptions.value];
    let categoriesChanged = false;
    let actionsChanged = false;
    let protocolsChanged = false;
    for (const record of records) {
      categoriesChanged =
        addFilterOption(nextCategories, categoryKeys, record.category) || categoriesChanged;
      actionsChanged = addFilterOption(nextActions, actionKeys, record.action) || actionsChanged;
      protocolsChanged =
        addFilterOption(nextProtocols, protocolKeys, record.protocol) || protocolsChanged;
    }
    if (categoriesChanged) categoryOptions.value = sortFilterOptions(nextCategories);
    if (actionsChanged) actionOptions.value = sortFilterOptions(nextActions);
    if (protocolsChanged) protocolOptions.value = sortFilterOptions(nextProtocols);
  }

  watch(
    uiActive,
    (active) => {
      if (active) updateUiFilterOptions(buffer.getRawItems(), true);
    },
    { flush: "sync" },
  );

  const batcher = createLogBatcher<FirewallLogRecord>({
    onFlush: (records) => {
      for (const sink of normalizedBatchSinks) {
        try {
          sink.onRecords(records);
        } catch (error: unknown) {
          errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
        }
      }
      buffer.pushMany(records);
      if (uiActive.value) updateUiFilterOptions(records);
      let nextLatestSourceTimestamp = latestSourceTimestamp.value;
      let latestEnqueuedTimestamp: string | null = null;

      for (const record of records) {
        if (
          (nextLatestSourceTimestamp === null || record.timestamp > nextLatestSourceTimestamp) &&
          Date.parse(record.timestamp) > 0
        ) {
          nextLatestSourceTimestamp = record.timestamp;
        }
        if (
          record.enqueuedTimeUtc &&
          (latestEnqueuedTimestamp === null || record.enqueuedTimeUtc > latestEnqueuedTimestamp)
        ) {
          latestEnqueuedTimestamp = record.enqueuedTimeUtc;
        }
      }

      latestSourceTimestamp.value = nextLatestSourceTimestamp;
      if (
        !caughtUp.value &&
        latestEnqueuedTimestamp !== null &&
        Date.now() - Date.parse(latestEnqueuedTimestamp) <= LIVE_TAIL_THRESHOLD_MS
      ) {
        caughtUp.value = true;
      }
      receivedCount.value += records.length;
      logHistoryPersistence.queueRecords(records);
    },
  });

  function teardown() {
    status.value = "idle";

    if (disconnectPromise) {
      return disconnectPromise;
    }

    const activeSubscription = subscription;
    const activeClient = client;
    const activeManagedController = managedStreamController;
    const activeManagedStream = managedStreamPromise;
    subscription = null;
    client = null;
    managedStreamController = null;
    managedStreamPromise = null;

    const teardownPromise = (async () => {
      const failures: unknown[] = [];

      activeManagedController?.abort();
      if (activeManagedStream) {
        try {
          await activeManagedStream;
        } catch (error: unknown) {
          if (!activeManagedController?.signal.aborted) {
            failures.push(error);
          }
        }
      }

      if (activeSubscription) {
        try {
          await activeSubscription.close();
        } catch (error: unknown) {
          failures.push(error);
        }
      }

      if (activeClient) {
        try {
          await activeClient.close();
        } catch (error: unknown) {
          failures.push(error);
        }
      }

      try {
        batcher.flush();
      } catch (error: unknown) {
        failures.push(error);
      }

      try {
        buffer.flush();
      } catch (error: unknown) {
        failures.push(error);
      }

      try {
        await logHistoryPersistence.flush();
      } catch (error: unknown) {
        failures.push(error);
      }

      try {
        logHistoryPersistence.clearQueueIfDisabled();
      } catch (error: unknown) {
        failures.push(error);
      }

      if (failures.length > 0) {
        const messages = failures.map(getErrorMessage);
        errors.value = [...messages, ...errors.value].slice(0, 5);
        throw new AggregateError(failures, messages.join(" "));
      }
    })();

    const serializedPromise = teardownPromise.finally(() => {
      if (disconnectPromise === serializedPromise) {
        disconnectPromise = null;
      }
    });
    disconnectPromise = serializedPromise;
    return serializedPromise;
  }

  function disconnect() {
    connectionGeneration += 1;
    return teardown();
  }

  async function connect(form: EventHubConnectionForm, mode: EventHubConnectionMode = "manual") {
    const validationErrors =
      mode === "managed"
        ? validateEventHubReceiverSettings(form)
        : validateEventHubConnectionForm(form);
    if (validationErrors.length > 0) {
      errors.value = validationErrors;
      return false;
    }

    const generation = ++connectionGeneration;

    try {
      await teardown();
    } catch {
      return false;
    }

    if (generation !== connectionGeneration) {
      return false;
    }

    status.value = "connecting";
    errors.value = [];
    visibleLimit.value = form.bufferSize;
    latestSourceTimestamp.value = null;
    caughtUp.value = false;

    try {
      if (mode === "managed") {
        const controller = new AbortController();
        managedStreamController = controller;
        const response = await managedFetch("/api/event-hub/stream", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            consumerGroup: form.consumerGroup.trim(),
            lookbackMinutes: form.lookbackMinutes,
          }),
          signal: controller.signal,
        });
        if (!response.ok || response.body === null) {
          throw new Error(`Managed Event Hub connection failed (${response.status})`);
        }
        if (generation !== connectionGeneration) {
          controller.abort();
          return false;
        }

        status.value = "connected";
        const streamPromise = consumeManagedEventHubStream(
          response.body,
          (envelope) => {
            if (generation !== connectionGeneration) {
              return;
            }
            if (envelope.type === "error") {
              errors.value = [envelope.message, ...errors.value].slice(0, 5);
              return;
            }
            if (envelope.type !== "events" || status.value !== "connected") {
              return;
            }

            for (const event of envelope.events) {
              const result = eventsToFirewallLogs([event], event.partitionId, nextRecordIndex);
              nextRecordIndex = result.nextIndex;
              batcher.pushMany(result.records);
            }
          },
          controller.signal,
        )
          .then(() => {
            if (generation === connectionGeneration && !controller.signal.aborted) {
              errors.value = ["Managed Event Hub stream ended", ...errors.value].slice(0, 5);
              status.value = "error";
            }
          })
          .catch((error: unknown) => {
            if (generation === connectionGeneration && !controller.signal.aborted) {
              errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
              status.value = "error";
            }
          })
          .finally(() => {
            if (managedStreamController === controller) {
              managedStreamController = null;
              managedStreamPromise = null;
            }
          });
        managedStreamPromise = streamPromise;
        return true;
      }

      const createClient = await loadClientFactory();

      if (generation !== connectionGeneration) {
        return false;
      }

      client = createClient(form);

      subscription = client.subscribe(
        {
          processEvents: async (events, context) => {
            if (generation !== connectionGeneration || status.value !== "connected") {
              return;
            }

            const result = eventsToFirewallLogs(events, context.partitionId, nextRecordIndex);
            nextRecordIndex = result.nextIndex;
            batcher.pushMany(result.records);
          },
          processError: async (error) => {
            if (generation !== connectionGeneration) {
              return;
            }

            errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
          },
        },
        {
          maxBatchSize: 1,
          startPosition: {
            enqueuedOn: getEventHubLookbackStart(form.lookbackMinutes),
          },
        },
      );

      status.value = "connected";
      return true;
    } catch (error: unknown) {
      if (generation !== connectionGeneration) {
        return false;
      }

      const connectionError = getErrorMessage(error);

      await teardown().catch(() => undefined);

      if (generation === connectionGeneration) {
        errors.value = [connectionError, ...errors.value].slice(0, 5);
        status.value = "error";
      }

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
    categoryOptions.value = [];
    actionOptions.value = [];
    protocolOptions.value = [];
    categoryKeys.clear();
    actionKeys.clear();
    protocolKeys.clear();
    receivedCount.value = 0;
    nextRecordIndex = 0;
    latestSourceTimestamp.value = null;
    caughtUp.value = false;
    for (const sink of normalizedBatchSinks) {
      sink.onClear?.();
    }
  }

  function addNormalizedBatchSink(sink: NormalizedLogBatchSink) {
    normalizedBatchSinks.add(sink);
    return () => normalizedBatchSinks.delete(sink);
  }

  return {
    status,
    actionOptions,
    categoryOptions,
    errors,
    getRawLogs: buffer.getRawItems,
    logs: buffer.items,
    protocolOptions,
    snapshotVersion: buffer.version,
    visibleLimit,
    receivedCount,
    latestSourceTimestamp,
    caughtUp,
    paused,
    connect,
    disconnect,
    pause,
    resume,
    clear,
    addNormalizedBatchSink,
  };
}
