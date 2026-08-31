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
import type { FirewallLogRecord } from "#shared/types/firewall";
import type { ManagedEventHubStreamRequest } from "#shared/types/managedEventHub";
import { consumeManagedEventHubStream } from "~/utils/managedEventHubStream";
import { createNetworkRuleCorrelator } from "~/utils/networkRuleCorrelation";
import { computed, watch, type Ref } from "vue";

type ReceiverStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "paused"
  | "error";
const LIVE_TAIL_THRESHOLD_MS = 30_000;
const SEQUENCE_NUMBER_PATTERN = /^\d+$/;
const MANUAL_EVENT_HUB_MAX_BATCH_SIZE = 50;
const MANUAL_EVENT_HUB_MAX_WAIT_TIME_SECONDS = 2;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY_MS = 1_000;
const RECONNECT_MAX_DELAY_MS = 8_000;

export interface ReceiverSubscription {
  close(): Promise<void>;
}
export interface EventHubLogEvent {
  body: unknown;
  enqueuedTimeUtc?: Date | string;
  sequenceNumber?: number | string;
  offset?: number | string;
  properties?: Record<string, unknown>;
}

interface ReceiverPartitionContext {
  partitionId: string;
  updateCheckpoint?(event: EventHubLogEvent): Promise<void>;
}

type ReceiverStartPosition =
  | { enqueuedOn: Date }
  | Record<string, { enqueuedOn: Date } | { sequenceNumber: number; isInclusive: false }>;

export interface EventHubReceiverClient {
  close(): Promise<void>;
  getPartitionIds?(): Promise<string[]>;
  subscribe(
    handlers: {
      processEvents(
        events: readonly EventHubLogEvent[],
        context: ReceiverPartitionContext,
      ): Promise<void>;
      processError(error: unknown): Promise<void>;
    },
    options: {
      maxBatchSize: number;
      maxWaitTimeInSeconds: number;
      startPosition: ReceiverStartPosition;
    },
  ): ReceiverSubscription;
}

export type CreateEventHubReceiverClient = (form: EventHubConnectionForm) => EventHubReceiverClient;

export interface EventHubReceiverOptions {
  loadClientFactory?: () => Promise<CreateEventHubReceiverClient>;
  managedFetch?: typeof fetch;
  revalidateManagedSession?: () => Promise<boolean>;
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

function getTeardownErrorMessages(error: unknown) {
  return error instanceof AggregateError
    ? error.errors.map(getErrorMessage)
    : [getErrorMessage(error)];
}

function getSequenceNumber(event: EventHubLogEvent) {
  if (typeof event.sequenceNumber === "number") {
    return Number.isSafeInteger(event.sequenceNumber) && event.sequenceNumber >= 0
      ? event.sequenceNumber
      : null;
  }

  if (
    typeof event.sequenceNumber !== "string" ||
    !SEQUENCE_NUMBER_PATTERN.test(event.sequenceNumber)
  ) {
    return null;
  }

  const sequenceNumber = Number(event.sequenceNumber);
  return Number.isSafeInteger(sequenceNumber) ? sequenceNumber : null;
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
      getPartitionIds: () => eventHubClient.getPartitionIds(),
      subscribe: (handlers, options) => eventHubClient.subscribe(handlers, options),
    };
  };
}

export function getManualEventHubStartPosition(
  lookbackMinutes: number,
  expectedPartitionIds: readonly string[],
  resumeFrom?: ReadonlyMap<string, number>,
): ReceiverStartPosition {
  const lookbackPosition = { enqueuedOn: getEventHubLookbackStart(lookbackMinutes) };
  if (!resumeFrom || expectedPartitionIds.length === 0) {
    return lookbackPosition;
  }

  return Object.fromEntries(
    expectedPartitionIds.map((partitionId) => {
      const sequenceNumber = resumeFrom.get(partitionId);
      return [
        partitionId,
        sequenceNumber === undefined
          ? lookbackPosition
          : { sequenceNumber, isInclusive: false as const },
      ];
    }),
  );
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
      applicationProperties: event.properties,
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
  revalidateManagedSession = async () => {
    const auth = useOidcAuth();
    await auth.fetch();
    return auth.loggedIn.value;
  },
  uiPublishingEnabled,
}: EventHubReceiverOptions = {}) {
  const status = useState<ReceiverStatus>("event-hub-status", () => "idle");
  const errors = useState<string[]>("event-hub-errors", () => []);
  const receivedCount = useState("event-hub-received-count", () => 0);
  const sourceRecordCount = useState("event-hub-source-record-count", () => receivedCount.value);
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
  const resumeFrom = new Map<string, number>();
  let nextRecordIndex = sourceRecordCount.value;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectInFlight = false;
  let activeConnection: {
    form: EventHubConnectionForm;
    mode: EventHubConnectionMode;
  } | null = null;

  function getResumeFrom() {
    const snapshot: Record<string, number> = {};
    for (const [partitionId, sequenceNumber] of resumeFrom) {
      snapshot[partitionId] = sequenceNumber;
    }
    return snapshot;
  }

  function receiveEvents(events: readonly EventHubLogEvent[], partitionId: string) {
    const acceptedEvents: EventHubLogEvent[] = [];
    const previousSequenceNumber = resumeFrom.get(partitionId);
    let highestSequenceNumber = previousSequenceNumber;
    let checkpointEvent: EventHubLogEvent | null = null;

    for (const event of events) {
      const sequenceNumber = getSequenceNumber(event);
      if (sequenceNumber !== null) {
        if (highestSequenceNumber !== undefined && sequenceNumber <= highestSequenceNumber) {
          continue;
        }
        highestSequenceNumber = sequenceNumber;
        checkpointEvent = event;
      }
      acceptedEvents.push(event);
    }

    if (acceptedEvents.length === 0) {
      return null;
    }

    const result = eventsToFirewallLogs(acceptedEvents, partitionId, nextRecordIndex);
    nextRecordIndex = result.nextIndex;
    batcher.pushMany(result.records);

    if (
      highestSequenceNumber !== undefined &&
      (previousSequenceNumber === undefined || highestSequenceNumber > previousSequenceNumber)
    ) {
      resumeFrom.set(partitionId, highestSequenceNumber);
    }
    return checkpointEvent;
  }

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

  function observeReceivedRecords(records: readonly FirewallLogRecord[]) {
    sourceRecordCount.value += records.length;
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
  }

  function publishAcceptedRecords(records: readonly FirewallLogRecord[]) {
    for (const sink of normalizedBatchSinks) {
      try {
        sink.onRecords(records);
      } catch (error: unknown) {
        errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
      }
    }
    buffer.pushMany(records);
    if (uiActive.value) updateUiFilterOptions(records);
    receivedCount.value += records.length;
    logHistoryPersistence.queueRecords(records);
  }

  const networkRuleCorrelator = createNetworkRuleCorrelator({
    maxCandidates: () => rawBufferSize.value,
    onRecords: publishAcceptedRecords,
  });
  const batcher = createLogBatcher<FirewallLogRecord>({
    onFlush: (records) => {
      observeReceivedRecords(records);
      networkRuleCorrelator.push(records);
    },
  });

  function cancelReconnect() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function teardown(setIdle = true) {
    if (setIdle) {
      status.value = "idle";
    }

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
        networkRuleCorrelator.flush();
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

  async function disconnect() {
    const clearTemporarySession = activeConnection?.mode === "manual";
    connectionGeneration += 1;
    activeConnection = null;
    reconnectAttempts = 0;
    cancelReconnect();
    resumeFrom.clear();

    let teardownSucceeded = false;
    let teardownErrors: string[] = [];
    try {
      await teardown();
      teardownSucceeded = true;
    } catch (error: unknown) {
      teardownErrors = getTeardownErrorMessages(error);
      throw error;
    } finally {
      if (clearTemporarySession) {
        clear();
        const historyCleared = await logHistoryPersistence.clearHistory();
        if (teardownSucceeded) {
          errors.value = historyCleared ? [] : ["Stored Event Hub history could not be cleared."];
        } else {
          errors.value = historyCleared
            ? teardownErrors.slice(0, 5)
            : ["Stored Event Hub history could not be cleared.", ...teardownErrors].slice(0, 5);
        }
      }
    }
  }

  function markRecovered() {
    reconnectAttempts = 0;
  }

  function scheduleReconnect(generation: number) {
    if (
      generation !== connectionGeneration ||
      activeConnection === null ||
      status.value === "idle" ||
      status.value === "paused" ||
      status.value === "error" ||
      reconnectTimer ||
      reconnectInFlight
    ) {
      return;
    }

    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      errors.value = ["Event Hub reconnect attempts exhausted", ...errors.value].slice(0, 5);
      status.value = "error";
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    );
    reconnectAttempts += 1;
    status.value = "reconnecting";
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void reconnect(generation);
    }, delay);
  }

  async function openConnection(
    form: EventHubConnectionForm,
    mode: EventHubConnectionMode,
    generation: number,
    isRetry: boolean,
  ) {
    if (mode === "managed") {
      const controller = new AbortController();
      managedStreamController = controller;
      const request: ManagedEventHubStreamRequest = {
        consumerGroup: form.consumerGroup.trim(),
        lookbackMinutes: form.lookbackMinutes,
      };
      if (isRetry) {
        request.resumeFrom = getResumeFrom();
      }
      const response = await managedFetch("/api/event-hub/stream", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          accept: "application/x-ndjson",
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
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
        async (envelope) => {
          if (generation !== connectionGeneration) {
            return;
          }
          if (envelope.type === "heartbeat") {
            markRecovered();
            return;
          }
          if (envelope.type === "caught-up") {
            markRecovered();
            caughtUp.value = true;
            return;
          }
          if (envelope.type === "error") {
            errors.value = [envelope.message, ...errors.value].slice(0, 5);
            if (envelope.message === "Session expired") {
              const sessionRecovered = await revalidateManagedSession().catch(() => false);
              if (generation !== connectionGeneration) {
                return;
              }
              controller.abort();
              if (sessionRecovered) {
                scheduleReconnect(generation);
              } else {
                errors.value = [
                  "Event Hub session expired. Sign in again to reconnect.",
                  ...errors.value,
                ].slice(0, 5);
                status.value = "error";
              }
            }
            return;
          }
          if (status.value !== "connected") {
            return;
          }

          markRecovered();
          for (const event of envelope.events) {
            receiveEvents([{ ...event, properties: event.applicationProperties }], event.partitionId);
          }
        },
        controller.signal,
      )
        .then(() => {
          if (generation === connectionGeneration && !controller.signal.aborted) {
            errors.value = ["Managed Event Hub stream ended", ...errors.value].slice(0, 5);
            scheduleReconnect(generation);
          }
        })
        .catch((error: unknown) => {
          if (generation === connectionGeneration && !controller.signal.aborted) {
            errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
            scheduleReconnect(generation);
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

    const nextClient = createClient(form);
    const expectedPartitionIds = (await nextClient.getPartitionIds?.()) ?? [];
    if (generation !== connectionGeneration) {
      await nextClient.close();
      return false;
    }
    client = nextClient;
    subscription = nextClient.subscribe(
      {
        processEvents: async (events, context) => {
          if (generation !== connectionGeneration || status.value !== "connected") {
            return;
          }

          markRecovered();
          if (events.length === 0) {
            caughtUp.value = true;
            return;
          }

          const checkpointEvent = receiveEvents(events, context.partitionId);
          if (checkpointEvent && context.updateCheckpoint) {
            await context.updateCheckpoint(checkpointEvent);
          }
        },
        processError: async (error) => {
          if (generation !== connectionGeneration) {
            return;
          }
          errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
          scheduleReconnect(generation);
        },
      },
      {
        maxBatchSize: MANUAL_EVENT_HUB_MAX_BATCH_SIZE,
        maxWaitTimeInSeconds: MANUAL_EVENT_HUB_MAX_WAIT_TIME_SECONDS,
        startPosition: getManualEventHubStartPosition(
          form.lookbackMinutes,
          expectedPartitionIds,
          isRetry ? resumeFrom : undefined,
        ),
      },
    );
    status.value = "connected";
    return true;
  }

  async function reconnect(generation: number) {
    if (generation !== connectionGeneration || activeConnection === null) {
      return;
    }

    reconnectInFlight = true;
    let retryFailed = false;
    try {
      await teardown(false);
      if (generation !== connectionGeneration || activeConnection === null) {
        return;
      }
      status.value = "reconnecting";
      const opened = await openConnection(
        activeConnection.form,
        activeConnection.mode,
        generation,
        true,
      );
      retryFailed = !opened;
    } catch (error: unknown) {
      if (generation === connectionGeneration) {
        errors.value = [getErrorMessage(error), ...errors.value].slice(0, 5);
        retryFailed = true;
      }
    } finally {
      reconnectInFlight = false;
    }

    if (retryFailed && generation === connectionGeneration) {
      scheduleReconnect(generation);
    }
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
    cancelReconnect();
    reconnectAttempts = 0;
    resumeFrom.clear();
    activeConnection = { form: { ...form }, mode };

    try {
      await teardown(false);
    } catch (error: unknown) {
      activeConnection = null;
      status.value = "error";
      if (mode === "manual") {
        clear();
        const historyCleared = await logHistoryPersistence.clearHistory();
        const teardownErrors = getTeardownErrorMessages(error);
        errors.value = historyCleared
          ? teardownErrors.slice(0, 5)
          : ["Stored Event Hub history could not be cleared.", ...teardownErrors].slice(0, 5);
      }
      return false;
    }

    if (generation !== connectionGeneration) {
      return false;
    }

    if (mode === "manual") {
      clear();
      errors.value = [];
      const historyCleared = await logHistoryPersistence.clearHistory();
      if (generation !== connectionGeneration) {
        return false;
      }
      if (!historyCleared) {
        activeConnection = null;
        status.value = "error";
        errors.value = ["Stored Event Hub history could not be cleared."];
        return false;
      }
    }

    status.value = "connecting";
    errors.value = [];
    visibleLimit.value = form.bufferSize;
    latestSourceTimestamp.value = null;
    caughtUp.value = false;

    try {
      return await openConnection(form, mode, generation, false);
    } catch (error: unknown) {
      if (generation !== connectionGeneration) {
        return false;
      }

      const connectionError = getErrorMessage(error);

      await teardown(false).catch(() => undefined);

      if (generation === connectionGeneration) {
        errors.value = [connectionError, ...errors.value].slice(0, 5);
        status.value = "connected";
        scheduleReconnect(generation);
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
    networkRuleCorrelator.clear();
    logHistoryPersistence.clearQueueIfDisabled();
    buffer.clear();
    categoryOptions.value = [];
    actionOptions.value = [];
    protocolOptions.value = [];
    categoryKeys.clear();
    actionKeys.clear();
    protocolKeys.clear();
    receivedCount.value = 0;
    sourceRecordCount.value = 0;
    nextRecordIndex = 0;
    latestSourceTimestamp.value = null;
    if (managedStreamController === null) {
      caughtUp.value = false;
    }
    for (const sink of normalizedBatchSinks) {
      sink.onClear?.();
    }
  }

  async function reset() {
    const clearTemporarySession = activeConnection?.mode === "manual";
    if (clearTemporarySession) {
      await disconnect();
      return;
    }

    const disconnecting = disconnect();
    clear();
    errors.value = [];
    await disconnecting;
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
    getResumeFrom,
    connect,
    disconnect,
    reset,
    pause,
    resume,
    clear,
    addNormalizedBatchSink,
  };
}
