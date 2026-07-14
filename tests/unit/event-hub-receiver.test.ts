import { computed, shallowRef, type Ref } from "vue";

import {
  createInitialEventHubConnectionForm,
  type EventHubConnectionForm,
} from "../../app/composables/useEventHubConnection";
import {
  eventsToFirewallLogs,
  type CreateEventHubReceiverClient,
  type EventHubReceiverClient,
} from "../../app/composables/useEventHubReceiver";
import type { FirewallLogRecord } from "../../app/types/firewall";

type ReceiverHandlers = Parameters<EventHubReceiverClient["subscribe"]>[0];

function createDeferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: resolvePromise,
  };
}

function createValidForm(): EventHubConnectionForm {
  const form = createInitialEventHubConnectionForm();
  form.connectionString =
    "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";
  return form;
}

function installNuxtMocks(order: string[] = []) {
  const logs = shallowRef<FirewallLogRecord[]>([]);
  const snapshotVersion = shallowRef(0);
  const pushMany = vi.fn((records: readonly FirewallLogRecord[]) => {
    order.push("batch-flush");
    logs.value = [...records, ...logs.value];
  });
  const historyFlush = vi.fn(async () => {
    order.push("history-flush");
  });
  const queueRecords = vi.fn();

  vi.stubGlobal(
    "useState",
    <T>(_key: string, initializer: () => T): Ref<T> => shallowRef(initializer()),
  );
  vi.stubGlobal("computed", computed);
  vi.stubGlobal("useBoundedLogBuffer", () => ({
    items: logs,
    pushMany,
    flush: vi.fn(),
    getRawItems: () => logs.value,
    version: snapshotVersion,
    clear: () => {
      logs.value = [];
      snapshotVersion.value += 1;
    },
  }));
  vi.stubGlobal("useLogHistoryPersistence", () => ({
    clearQueueIfDisabled: vi.fn(),
    flush: historyFlush,
    queueRecords,
  }));

  return {
    historyFlush,
    logs,
    pushMany,
    queueRecords,
  };
}

function requireHandlers(handlers: ReceiverHandlers | undefined) {
  if (!handlers) {
    throw new Error("Receiver handlers were not registered.");
  }

  return handlers;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("Event Hub receiver helpers", () => {
  it("connects managed mode with only receiver settings and reports stream EOF", async () => {
    installNuxtMocks();
    const encoder = new TextEncoder();
    let closeStream!: () => void;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        closeStream = () => controller.close();
        controller.enqueue(encoder.encode('{"type":"heartbeat"}\n'));
      },
    });
    const managedFetch = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    const loadClientFactory = vi.fn<() => Promise<CreateEventHubReceiverClient>>();
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({ loadClientFactory, managedFetch });
    const form = createInitialEventHubConnectionForm();
    form.consumerGroup = "  managed-consumer  ";
    form.lookbackMinutes = 3;

    await expect(receiver.connect(form, "managed")).resolves.toBe(true);
    expect(managedFetch).toHaveBeenCalledOnce();
    const [url, options] = managedFetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/event-hub/stream");
    expect(options).toMatchObject({
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/x-ndjson",
        "content-type": "application/json",
      },
      body: JSON.stringify({ consumerGroup: "managed-consumer", lookbackMinutes: 3 }),
    });
    expect(String(options?.body)).not.toContain("connectionString");
    expect(String(options?.body)).not.toContain("eventHubName");
    expect(loadClientFactory).not.toHaveBeenCalled();
    expect(receiver.status.value).toBe("connected");

    receiver.pause();
    expect(receiver.status.value).toBe("paused");
    receiver.resume();
    expect(receiver.status.value).toBe("connected");

    closeStream();
    await vi.waitFor(() => expect(receiver.status.value).toBe("error"));
    expect(receiver.errors.value).toContain("Managed Event Hub stream ended");
    await receiver.disconnect();
  });

  it("publishes managed network-rule DNS with Event Hub metadata", async () => {
    vi.useFakeTimers();
    installNuxtMocks();
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            `${JSON.stringify({
              type: "events",
              events: [
                {
                  body: {
                    category: "AZFWNetworkRule",
                    properties: {
                      Action: "Allow",
                      Protocol: "TCP",
                      SourceIp: "10.0.0.4",
                      SourcePort: 53_000,
                      DestinationIp: "168.63.129.16",
                      DestinationPort: 53,
                      Policy: "hub-policy",
                      RuleCollectionGroup: "hub-group",
                      RuleCollection: "dns-rules",
                      Rule: "allow-dns",
                    },
                    time: "2026-07-12T12:00:00.000Z",
                  },
                  enqueuedTimeUtc: "2026-07-12T12:00:01.000Z",
                  offset: "123",
                  partitionId: "0",
                  sequenceNumber: 42,
                  applicationProperties: { schemaVersion: "1", source: "managed" },
                },
              ],
            })}\n`,
          ),
        );
      },
    });
    const managedFetch = vi.fn<typeof fetch>(async () => new Response(body, { status: 200 }));
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({ managedFetch });
    const onRecords = vi.fn<(records: readonly FirewallLogRecord[]) => void>();
    receiver.addNormalizedBatchSink({ onRecords });

    await receiver.connect(createInitialEventHubConnectionForm(), "managed");
    await vi.waitFor(() => expect(receiver.status.value).toBe("connected"));
    vi.advanceTimersByTime(100);

    expect(onRecords).toHaveBeenCalledOnce();
    expect(onRecords.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        dns: expect.objectContaining({
          source: "network-rule",
          protocol: "TCP",
          clientIp: "10.0.0.4",
          serverIp: "168.63.129.16",
          policy: "hub-policy",
          ruleCollectionGroup: "hub-group",
          ruleCollection: "dns-rules",
          rule: "allow-dns",
        }),
        enqueuedTimeUtc: "2026-07-12T12:00:01.000Z",
        applicationProperties: { schemaVersion: "1", source: "managed" },
        offset: "123",
        partitionId: "0",
        sequenceNumber: "42",
      }),
    ]);

    await receiver.disconnect();
  });

  it("allocates unique record indexes across expanded queued events", () => {
    const result = eventsToFirewallLogs(
      [
        {
          body: {
            records: [
              { msg: "first", time: "2026-07-09T12:00:00.000Z" },
              { msg: "second", time: "2026-07-09T12:00:01.000Z" },
            ],
          },
          sequenceNumber: 10,
        },
        {
          body: {
            records: [{ msg: "third", time: "2026-07-09T12:00:02.000Z" }],
          },
          sequenceNumber: 11,
        },
      ],
      "0",
      7,
    );

    expect(result.nextIndex).toBe(10);
    expect(new Set(result.records.map((log) => log.id)).size).toBe(3);
    expect(result.records.map((log) => log.id)).toEqual([
      "0:10:0:2026-07-09T12:00:00.000Z:resource:unknown",
      "0:10:1:2026-07-09T12:00:01.000Z:resource:unknown",
      "0:11:0:2026-07-09T12:00:02.000Z:resource:unknown",
    ]);
  });

  it("normalizes equivalent manual and managed Event Hub DNS envelopes identically", () => {
    const body = {
      time: "2026-07-12T12:00:00.000Z",
      category: "AZFWNetworkRule",
      properties: {
        Action: "Allow",
        Protocol: "TCP",
        SourceIp: "10.0.0.4",
        SourcePort: 53_000,
        DestinationIp: "168.63.129.16",
        DestinationPort: 53,
      },
    };
    const properties = { schemaVersion: "1", diagnosticCategory: "network" };
    const manual = eventsToFirewallLogs(
      [
        {
          body,
          enqueuedTimeUtc: new Date("2026-07-12T12:00:01.000Z"),
          offset: "123",
          sequenceNumber: 42,
          properties,
        },
      ],
      "0",
      0,
    );
    const managed = eventsToFirewallLogs(
      [
        {
          body,
          enqueuedTimeUtc: "2026-07-12T12:00:01.000Z",
          offset: "123",
          sequenceNumber: 42,
          properties,
        },
      ],
      "0",
      0,
    );

    expect(managed).toEqual(manual);
    expect(managed.records[0]).toMatchObject({
      applicationProperties: properties,
      enqueuedTimeUtc: "2026-07-12T12:00:01.000Z",
      dns: {
        source: "network-rule",
        protocol: "TCP",
        clientIp: "10.0.0.4",
        serverIp: "168.63.129.16",
      },
    });
  });

  it("does not create or subscribe a client after connect is invalidated", async () => {
    installNuxtMocks();
    const factory = createDeferred<CreateEventHubReceiverClient>();
    const createClient = vi.fn<CreateEventHubReceiverClient>();
    const loadClientFactory = vi.fn(() => factory.promise);
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({ loadClientFactory });

    const connectPromise = receiver.connect(createValidForm());
    await vi.waitFor(() => expect(loadClientFactory).toHaveBeenCalledOnce());

    await receiver.disconnect();
    factory.resolve(createClient);

    await expect(connectPromise).resolves.toBe(false);
    expect(createClient).not.toHaveBeenCalled();
    expect(receiver.status.value).toBe("idle");
  });

  it("allows only latest competing connect to create a client", async () => {
    installNuxtMocks();
    const firstFactory = createDeferred<CreateEventHubReceiverClient>();
    const firstCreateClient = vi.fn<CreateEventHubReceiverClient>();
    const secondSubscribe = vi.fn(() => ({ close: vi.fn(async () => undefined) }));
    const secondClient: EventHubReceiverClient = {
      close: vi.fn(async () => undefined),
      subscribe: secondSubscribe,
    };
    const secondCreateClient = vi.fn(() => secondClient);
    const loadClientFactory = vi
      .fn<() => Promise<CreateEventHubReceiverClient>>()
      .mockReturnValueOnce(firstFactory.promise)
      .mockResolvedValueOnce(secondCreateClient);
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({ loadClientFactory });

    const firstConnect = receiver.connect(createValidForm());
    await vi.waitFor(() => expect(loadClientFactory).toHaveBeenCalledOnce());
    const secondConnect = receiver.connect(createValidForm());

    await expect(secondConnect).resolves.toBe(true);
    firstFactory.resolve(firstCreateClient);

    await expect(firstConnect).resolves.toBe(false);
    expect(firstCreateClient).not.toHaveBeenCalled();
    expect(secondCreateClient).toHaveBeenCalledOnce();
    expect(secondSubscribe).toHaveBeenCalledOnce();
    expect(receiver.status.value).toBe("connected");

    await receiver.disconnect();
  });

  it("uses selected lookback for subscription start position", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    installNuxtMocks();
    const subscribe = vi.fn<EventHubReceiverClient["subscribe"]>(() => ({
      close: vi.fn(async () => undefined),
    }));
    const client: EventHubReceiverClient = {
      close: vi.fn(async () => undefined),
      subscribe,
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    const form = createValidForm();
    form.lookbackMinutes = 3;

    await expect(receiver.connect(form)).resolves.toBe(true);

    expect(subscribe.mock.calls[0]?.[1]).toMatchObject({
      maxBatchSize: 1,
      startPosition: { enqueuedOn: new Date("2026-07-10T11:57:00.000Z") },
    });

    await receiver.disconnect();
  });

  it("collects filter options incrementally and resets them on clear", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-12T12:00:10.000Z"));
    installNuxtMocks();
    let handlers: ReceiverHandlers | undefined;
    const client: EventHubReceiverClient = {
      close: vi.fn(async () => undefined),
      subscribe: (nextHandlers) => {
        handlers = nextHandlers;
        return { close: vi.fn(async () => undefined) };
      },
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    await receiver.connect(createValidForm());

    await requireHandlers(handlers).processEvents(
      [
        {
          enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
          body: {
            records: [
              {
                time: "2026-07-12T12:00:02.000Z",
                category: "AZFWNetworkRule",
                action: "Allow",
                protocol: "TCP",
              },
              {
                time: "2026-07-12T12:00:01.000Z",
                category: "AZFWApplicationRule",
                action: "allow",
                protocol: "HTTPS",
              },
            ],
          },
        },
      ],
      { partitionId: "0" },
    );
    vi.advanceTimersByTime(100);

    expect(receiver.categoryOptions.value).toEqual(["AZFWApplicationRule", "AZFWNetworkRule"]);
    expect(receiver.actionOptions.value).toEqual(["Allow"]);
    expect(receiver.protocolOptions.value).toEqual(["HTTPS", "TCP"]);
    expect(receiver.latestSourceTimestamp.value).toBe("2026-07-12T12:00:02.000Z");
    expect(receiver.caughtUp.value).toBe(true);

    await requireHandlers(handlers).processEvents(
      [{ body: { time: "2026-07-12T12:00:00.000Z", category: "AZFWNetworkRule" } }],
      { partitionId: "0" },
    );
    vi.advanceTimersByTime(100);
    expect(receiver.latestSourceTimestamp.value).toBe("2026-07-12T12:00:02.000Z");

    receiver.clear();
    expect(receiver.categoryOptions.value).toEqual([]);
    expect(receiver.actionOptions.value).toEqual([]);
    expect(receiver.protocolOptions.value).toEqual([]);
    expect(receiver.latestSourceTimestamp.value).toBeNull();
    expect(receiver.caughtUp.value).toBe(false);
    await receiver.disconnect();
  });

  it("publishes normalized manual network-rule DNS with equivalent metadata and clears", async () => {
    vi.useFakeTimers();
    installNuxtMocks();
    let handlers: ReceiverHandlers | undefined;
    const client: EventHubReceiverClient = {
      close: vi.fn(async () => undefined),
      subscribe: (nextHandlers) => {
        handlers = nextHandlers;
        return { close: vi.fn(async () => undefined) };
      },
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    const onRecords = vi.fn<(records: readonly FirewallLogRecord[]) => void>();
    const onClear = vi.fn<() => void>();
    receiver.addNormalizedBatchSink({ onClear, onRecords });
    await receiver.connect(createValidForm());

    await requireHandlers(handlers).processEvents(
      [
        {
          body: {
            category: "AZFWNetworkRule",
            properties: {
              Action: "Allow",
              Protocol: "TCP",
              SourceIp: "10.0.0.4",
              SourcePort: 53_000,
              DestinationIp: "168.63.129.16",
              DestinationPort: 53,
              Policy: "hub-policy",
              RuleCollectionGroup: "hub-group",
              RuleCollection: "dns-rules",
              Rule: "allow-dns",
            },
            time: "2026-07-12T12:00:00.000Z",
          },
          enqueuedTimeUtc: new Date("2026-07-12T12:00:01.000Z"),
          sequenceNumber: 42,
          offset: "123",
          properties: { schemaVersion: "1", source: "manual" },
        },
      ],
      { partitionId: "0" },
    );

    expect(onRecords).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onRecords).toHaveBeenCalledOnce();
    expect(onRecords.mock.calls[0]?.[0]).toEqual([
      expect.objectContaining({
        category: "AZFWNetworkRule",
        dns: expect.objectContaining({
          source: "network-rule",
          protocol: "TCP",
          clientIp: "10.0.0.4",
          serverIp: "168.63.129.16",
          policy: "hub-policy",
          ruleCollectionGroup: "hub-group",
          ruleCollection: "dns-rules",
          rule: "allow-dns",
        }),
        enqueuedTimeUtc: "2026-07-12T12:00:01.000Z",
        applicationProperties: { schemaVersion: "1", source: "manual" },
        partitionId: "0",
        sequenceNumber: "42",
        offset: "123",
      }),
    ]);

    receiver.clear();
    expect(onClear).toHaveBeenCalledOnce();
    await receiver.disconnect();
  });

  it("defers all-log filter option work while its UI is inactive and rebuilds on return", async () => {
    vi.useFakeTimers();
    installNuxtMocks();
    const uiPublishingEnabled = shallowRef(false);
    let handlers: ReceiverHandlers | undefined;
    const client: EventHubReceiverClient = {
      close: vi.fn(async () => undefined),
      subscribe: (nextHandlers) => {
        handlers = nextHandlers;
        return { close: vi.fn(async () => undefined) };
      },
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
      uiPublishingEnabled,
    });
    await receiver.connect(createValidForm());

    await requireHandlers(handlers).processEvents(
      [
        {
          body: {
            category: "AZFWNetworkRule",
            properties: { Action: "Deny", Protocol: "UDP" },
          },
          sequenceNumber: 1,
        },
      ],
      { partitionId: "0" },
    );
    vi.advanceTimersByTime(100);

    expect(receiver.categoryOptions.value).toEqual([]);
    expect(receiver.actionOptions.value).toEqual([]);
    expect(receiver.protocolOptions.value).toEqual([]);

    uiPublishingEnabled.value = true;
    expect(receiver.categoryOptions.value).toEqual(["AZFWNetworkRule"]);
    expect(receiver.actionOptions.value).toEqual(["Deny"]);
    expect(receiver.protocolOptions.value).toEqual(["UDP"]);
    await receiver.disconnect();
  });

  it("continues receiving after subscription errors", async () => {
    vi.useFakeTimers();
    installNuxtMocks();
    let handlers: ReceiverHandlers | undefined;
    const client: EventHubReceiverClient = {
      close: vi.fn(async () => undefined),
      subscribe: (nextHandlers) => {
        handlers = nextHandlers;
        return { close: vi.fn(async () => undefined) };
      },
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    await receiver.connect(createValidForm());

    await requireHandlers(handlers).processError(new Error("transient receive failure"));
    expect(receiver.status.value).toBe("connected");
    expect(receiver.errors.value).toEqual(["transient receive failure"]);

    receiver.pause();
    await requireHandlers(handlers).processError(new Error("paused receive failure"));
    expect(receiver.status.value).toBe("paused");
    expect(receiver.errors.value).toEqual(["paused receive failure", "transient receive failure"]);
    receiver.resume();

    await requireHandlers(handlers).processEvents([{ body: { msg: "recovered" } }], {
      partitionId: "0",
    });
    vi.advanceTimersByTime(100);
    expect(receiver.receivedCount.value).toBe(1);

    await receiver.disconnect();
  });

  it("closes resources before flushing and ignores teardown callbacks", async () => {
    const order: string[] = [];
    const mocks = installNuxtMocks(order);
    let handlers: ReceiverHandlers | undefined;
    const subscriptionClose = vi.fn(async () => {
      order.push("subscription-close");
      const registeredHandlers = requireHandlers(handlers);
      await registeredHandlers.processEvents(
        [{ body: { msg: "late", time: "2026-07-09T12:01:00.000Z" } }],
        { partitionId: "0" },
      );
      await registeredHandlers.processError(new Error("late receiver error"));
    });
    const clientClose = vi.fn(async () => {
      order.push("client-close");
    });
    const client: EventHubReceiverClient = {
      close: clientClose,
      subscribe: (nextHandlers) => {
        handlers = nextHandlers;
        return { close: subscriptionClose };
      },
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });

    await expect(receiver.connect(createValidForm())).resolves.toBe(true);
    order.length = 0;
    await requireHandlers(handlers).processEvents(
      [{ body: { msg: "pending", time: "2026-07-09T12:00:00.000Z" } }],
      { partitionId: "0" },
    );

    await receiver.disconnect();

    expect(order).toEqual(["subscription-close", "client-close", "batch-flush", "history-flush"]);
    expect(mocks.logs.value).toHaveLength(1);
    expect(mocks.queueRecords).toHaveBeenCalledOnce();
    expect(receiver.receivedCount.value).toBe(1);
    expect(receiver.errors.value).toEqual([]);
    expect(receiver.status.value).toBe("idle");
  });

  it("resets paused receiver resources and buffered state", async () => {
    vi.useFakeTimers();
    const mocks = installNuxtMocks();
    let handlers: ReceiverHandlers | undefined;
    const subscriptionClose = vi.fn<() => Promise<void>>(async () => undefined);
    const clientClose = vi.fn<() => Promise<void>>(async () => undefined);
    const client: EventHubReceiverClient = {
      close: clientClose,
      subscribe: (nextHandlers) => {
        handlers = nextHandlers;
        return { close: subscriptionClose };
      },
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    const onClear = vi.fn<() => void>();
    receiver.addNormalizedBatchSink({
      onClear,
      onRecords: vi.fn<(records: readonly FirewallLogRecord[]) => void>(),
    });
    await receiver.connect(createValidForm());
    await requireHandlers(handlers).processEvents(
      [
        {
          body: {
            category: "AZFWNetworkRule",
            properties: { Action: "Allow", Protocol: "UDP" },
            time: "2026-07-12T12:00:00.000Z",
          },
        },
      ],
      { partitionId: "0" },
    );
    await requireHandlers(handlers).processError(new Error("stale receiver error"));
    vi.advanceTimersByTime(100);
    expect(mocks.logs.value).toHaveLength(1);
    expect(receiver.receivedCount.value).toBe(1);

    receiver.pause();
    await receiver.reset();

    expect(subscriptionClose).toHaveBeenCalledOnce();
    expect(clientClose).toHaveBeenCalledOnce();
    expect(mocks.logs.value).toEqual([]);
    expect(receiver.receivedCount.value).toBe(0);
    expect(receiver.latestSourceTimestamp.value).toBeNull();
    expect(receiver.errors.value).toEqual([]);
    expect(receiver.status.value).toBe("idle");
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("shares one teardown across overlapping disconnect calls", async () => {
    installNuxtMocks();
    const closeBarrier = createDeferred<void>();
    const subscriptionClose = vi.fn(() => closeBarrier.promise);
    const clientClose = vi.fn(async () => undefined);
    const client: EventHubReceiverClient = {
      close: clientClose,
      subscribe: () => ({ close: subscriptionClose }),
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    await receiver.connect(createValidForm());

    const firstDisconnect = receiver.disconnect();
    const secondDisconnect = receiver.disconnect();

    expect(receiver.status.value).toBe("idle");
    expect(subscriptionClose).toHaveBeenCalledOnce();

    closeBarrier.resolve();
    await Promise.all([firstDisconnect, secondDisconnect]);

    expect(subscriptionClose).toHaveBeenCalledOnce();
    expect(clientClose).toHaveBeenCalledOnce();
    expect(receiver.status.value).toBe("idle");
  });

  it("attempts both closes, reports failures, and clears resource references", async () => {
    installNuxtMocks();
    const subscriptionClose = vi.fn(async () => {
      throw new Error("subscription close failed");
    });
    const clientClose = vi.fn(async () => {
      throw new Error("client close failed");
    });
    const client: EventHubReceiverClient = {
      close: clientClose,
      subscribe: () => ({ close: subscriptionClose }),
    };
    const { useEventHubReceiver } = await import("../../app/composables/useEventHubReceiver");
    const receiver = useEventHubReceiver({
      loadClientFactory: async () => () => client,
    });
    await receiver.connect(createValidForm());

    await expect(receiver.disconnect()).rejects.toThrow(
      "subscription close failed client close failed",
    );

    expect(subscriptionClose).toHaveBeenCalledOnce();
    expect(clientClose).toHaveBeenCalledOnce();
    expect(receiver.errors.value).toEqual(["subscription close failed", "client close failed"]);
    expect(receiver.status.value).toBe("idle");

    await expect(receiver.disconnect()).resolves.toBeUndefined();
    expect(subscriptionClose).toHaveBeenCalledOnce();
    expect(clientClose).toHaveBeenCalledOnce();
  });
});
