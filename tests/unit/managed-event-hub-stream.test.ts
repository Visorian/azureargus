import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";

import {
  createManagedEventHubStream,
  pipeManagedEventHubStream,
  validateManagedEventHubStreamRequest,
  type ManagedEventHubClient,
} from "../../server/utils/managedEventHubStream";

type StreamHandlers = Parameters<ManagedEventHubClient["subscribe"]>[0];

function createPartitionContext(partitionId: string) {
  return {
    partitionId,
    updateCheckpoint: vi.fn<(event: { sequenceNumber: number }) => Promise<void>>(
      async () => undefined,
    ),
  };
}

function createClient() {
  let handlers: StreamHandlers | undefined;
  const subscriptionClose = vi.fn(async () => undefined);
  const clientClose = vi.fn(async () => undefined);
  const subscribe = vi.fn<ManagedEventHubClient["subscribe"]>((nextHandlers) => {
    handlers = nextHandlers;
    return { close: subscriptionClose };
  });

  return {
    client: { close: clientClose, subscribe },
    clientClose,
    getHandlers: () => {
      if (!handlers) {
        throw new Error("Stream handlers were not registered");
      }
      return handlers;
    },
    subscribe,
    subscriptionClose,
  };
}

function parseEnvelope(result: ReadableStreamReadResult<Uint8Array>) {
  expect(result.done).toBe(false);
  return JSON.parse(new TextDecoder().decode(result.value).trim()) as unknown;
}

async function readEnvelope(reader: ReadableStreamDefaultReader<Uint8Array>) {
  return parseEnvelope(await reader.read());
}

afterEach(() => {
  vi.useRealTimers();
});

describe("managed Event Hub stream", () => {
  it("accepts only the bounded public request DTO", () => {
    expect(
      validateManagedEventHubStreamRequest({
        consumerGroup: "$Default",
        lookbackMinutes: 5,
      }),
    ).toBe(true);
    expect(
      validateManagedEventHubStreamRequest({
        connectionString: "secret",
        consumerGroup: "$Default",
        lookbackMinutes: 5,
      }),
    ).toBe(false);
    expect(
      validateManagedEventHubStreamRequest({
        consumerGroup: " padded ",
        lookbackMinutes: 5,
      }),
    ).toBe(false);
    expect(
      validateManagedEventHubStreamRequest({
        consumerGroup: "$Default",
        lookbackMinutes: 30,
      }),
    ).toBe(false);
    expect(
      validateManagedEventHubStreamRequest({
        consumerGroup: "$Default",
        lookbackMinutes: 5,
        resumeFrom: { "0": 42, "1": 0 },
      }),
    ).toBe(true);
    for (const resumeFrom of [
      { "": 1 },
      { partition: 1 },
      { "0": -1 },
      { "0": 1.5 },
      { "0": Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(
        validateManagedEventHubStreamRequest({
          consumerGroup: "$Default",
          lookbackMinutes: 5,
          resumeFrom,
        }),
      ).toBe(false);
    }
  });

  it("uses stream demand as backpressure and maps received events", async () => {
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0", "1"],
      request: { consumerGroup: "$Default", lookbackMinutes: 3 },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      now: () => 0,
    });
    const processing = fixture
      .getHandlers()
      .processEvents(
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
              },
            },
            enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
            sequenceNumber: 42,
            offset: "123",
            properties: { schemaVersion: "1", diagnosticCategory: "network" },
          },
        ],
        createPartitionContext("1"),
      );

    const reader = managed.stream.getReader();
    await expect(readEnvelope(reader)).resolves.toEqual({
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
            },
          },
          enqueuedTimeUtc: "2026-07-12T12:00:00.000Z",
          partitionId: "1",
          sequenceNumber: 42,
          offset: "123",
          applicationProperties: {
            schemaVersion: "1",
            diagnosticCategory: "network",
          },
        },
      ],
    });
    await processing;
    expect(fixture.subscribe.mock.calls[0]?.[1]).toMatchObject({
      maxBatchSize: 50,
      maxWaitTimeInSeconds: 2,
    });
    expect(fixture.subscribe.mock.calls[0]?.[1].startPosition).toEqual({
      enqueuedOn: new Date(-3 * 60_000),
    });

    await reader.cancel();
    expect(fixture.subscriptionClose).toHaveBeenCalledOnce();
    expect(fixture.clientClose).toHaveBeenCalledOnce();
  });

  it("bounds queued bytes and resumes producers when the consumer drains", async () => {
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0"],
      request: { consumerGroup: "$Default", lookbackMinutes: 3 },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      now: () => 0,
    });
    const context = createPartitionContext("0");
    const event = (sequenceNumber: number) => ({
      body: "x".repeat(100_000),
      enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
      sequenceNumber,
    });

    await fixture.getHandlers().processEvents([event(1)], context);
    await fixture.getHandlers().processEvents([event(2)], context);
    let thirdProcessed = false;
    const thirdBatch = fixture
      .getHandlers()
      .processEvents([event(3)], context)
      .then(() => {
        thirdProcessed = true;
      });
    await Promise.resolve();
    expect(thirdProcessed).toBe(false);

    const reader = managed.stream.getReader();
    const queuedEnvelopes = [await reader.read(), await reader.read(), await reader.read()];
    await thirdBatch;
    expect(thirdProcessed).toBe(true);
    expect(
      queuedEnvelopes.reduce((bytes, result) => bytes + (result.value?.byteLength ?? 0), 0),
    ).toBeLessThanOrEqual(256 * 1024 + (queuedEnvelopes[0]?.value?.byteLength ?? 0));

    await reader.cancel();
  });

  it("uses resume positions and advances checkpoints without regression", async () => {
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0", "1"],
      request: {
        consumerGroup: "$Default",
        lookbackMinutes: 3,
        resumeFrom: { "0": 40 },
      },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      now: () => 0,
    });
    const reader = managed.stream.getReader();
    const context = createPartitionContext("0");
    const event = (sequenceNumber: number) => ({
      body: { sequenceNumber },
      enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
      sequenceNumber,
    });

    expect(fixture.subscribe.mock.calls[0]?.[1].startPosition).toEqual({
      "0": { sequenceNumber: 40, isInclusive: false },
      "1": { enqueuedOn: new Date(-3 * 60_000) },
    });

    const firstBatch = fixture
      .getHandlers()
      .processEvents([event(41), event(43), event(42)], context);
    await expect(readEnvelope(reader)).resolves.toMatchObject({
      type: "events",
    });
    await firstBatch;
    expect(context.updateCheckpoint).toHaveBeenCalledOnce();
    expect(context.updateCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequenceNumber: 43 }),
    );

    const replayedBatch = fixture.getHandlers().processEvents([event(42)], context);
    await expect(readEnvelope(reader)).resolves.toMatchObject({
      type: "events",
    });
    await replayedBatch;
    expect(context.updateCheckpoint).toHaveBeenCalledOnce();

    const advancingBatch = fixture.getHandlers().processEvents([event(44)], context);
    await expect(readEnvelope(reader)).resolves.toMatchObject({
      type: "events",
    });
    await advancingBatch;
    expect(context.updateCheckpoint).toHaveBeenCalledTimes(2);
    expect(context.updateCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({ sequenceNumber: 44 }),
    );

    await reader.cancel();
  });

  it("emits caught-up once after every expected partition returns an empty batch", async () => {
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0", "1"],
      request: { consumerGroup: "$Default", lookbackMinutes: 3 },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      now: () => 0,
    });
    const reader = managed.stream.getReader();
    const eventProcessing = fixture.getHandlers().processEvents(
      [
        {
          body: { message: "allow" },
          enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
          sequenceNumber: 42,
        },
      ],
      createPartitionContext("0"),
    );

    await expect(readEnvelope(reader)).resolves.toMatchObject({
      type: "events",
    });
    await eventProcessing;

    const caughtUpRead = reader.read();
    await fixture.getHandlers().processEvents([], createPartitionContext("unknown"));
    await expect(
      Promise.race([
        caughtUpRead.then(() => "envelope"),
        new Promise<string>((resolve) => setTimeout(resolve, 0, "pending")),
      ]),
    ).resolves.toBe("pending");

    await fixture.getHandlers().processEvents([], createPartitionContext("1"));
    await expect(
      Promise.race([
        caughtUpRead.then(() => "envelope"),
        new Promise<string>((resolve) => setTimeout(resolve, 0, "pending")),
      ]),
    ).resolves.toBe("pending");

    const finalPartition = fixture.getHandlers().processEvents([], createPartitionContext("0"));
    await expect(caughtUpRead.then(parseEnvelope)).resolves.toEqual({
      type: "caught-up",
    });
    await finalPartition;

    const duplicateRead = reader.read();
    await fixture.getHandlers().processEvents([], createPartitionContext("0"));
    await fixture.getHandlers().processEvents([], createPartitionContext("1"));
    await expect(
      Promise.race([
        duplicateRead.then(() => "envelope"),
        new Promise<string>((resolve) => setTimeout(resolve, 0, "pending")),
      ]),
    ).resolves.toBe("pending");

    await reader.cancel();
  });

  it("emits caught-up for a quiet single-partition stream", async () => {
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0"],
      request: { consumerGroup: "$Default", lookbackMinutes: 3 },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      now: () => 0,
    });
    const reader = managed.stream.getReader();

    const caughtUp = fixture.getHandlers().processEvents([], createPartitionContext("0"));

    await expect(readEnvelope(reader)).resolves.toEqual({ type: "caught-up" });
    await caughtUp;
    await reader.cancel();
  });

  it("transports binary event bodies as compact UTF-8 text", async () => {
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0", "1"],
      request: { consumerGroup: "$Default", lookbackMinutes: 3 },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      now: () => 0,
    });
    const body = '{"records":[{"category":"AzureFirewallDnsProxy"}]}';
    const processing = fixture.getHandlers().processEvents(
      [
        {
          body: new TextEncoder().encode(body),
          enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
          sequenceNumber: 42,
        },
      ],
      createPartitionContext("1"),
    );
    const reader = managed.stream.getReader();

    await expect(readEnvelope(reader)).resolves.toMatchObject({
      type: "events",
      events: [{ body }],
    });
    await processing;
    await reader.cancel();
  });

  it("waits for Node response drain before reading another stream chunk", async () => {
    const request = new IncomingMessage(new Socket());
    const response = new ServerResponse(request);
    const write = vi.spyOn(response, "write").mockReturnValueOnce(false).mockReturnValue(true);
    const end = vi.spyOn(response, "end").mockImplementation(() => response);
    let secondPull = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (secondPull) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array([1]));
        secondPull = true;
      },
    });

    const piping = pipeManagedEventHubStream(response, stream);
    await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
    expect(end).not.toHaveBeenCalled();

    response.emit("drain");
    await piping;
    expect(end).toHaveBeenCalledOnce();
  });

  it("emits heartbeats and closes all resources on cancellation", async () => {
    vi.useFakeTimers();
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0", "1"],
      request: { consumerGroup: "$Default", lookbackMinutes: 1 },
      sessionExpiresAt: 10,
      revalidateSession: async () => true,
      heartbeatIntervalMs: 1_000,
      now: () => 0,
    });
    const reader = managed.stream.getReader();

    const heartbeat = readEnvelope(reader);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(heartbeat).resolves.toEqual({ type: "heartbeat" });

    await reader.cancel();
    await managed.cleanup();
    expect(fixture.subscriptionClose).toHaveBeenCalledOnce();
    expect(fixture.clientClose).toHaveBeenCalledOnce();
  });

  it("reports fixed expiry and failed session revalidation before cleanup", async () => {
    vi.useFakeTimers();

    for (const trigger of ["expiry", "revalidation"] as const) {
      const fixture = createClient();
      const managed = createManagedEventHubStream({
        client: fixture.client,
        expectedPartitionIds: ["0", "1"],
        request: { consumerGroup: "$Default", lookbackMinutes: 1 },
        sessionExpiresAt: trigger === "expiry" ? 1 : 60,
        revalidateSession: async () => trigger !== "revalidation",
        heartbeatIntervalMs: 60_000,
        sessionCheckIntervalMs: 1_000,
        now: () => 0,
      });
      const reader = managed.stream.getReader();
      const error = readEnvelope(reader);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(error).resolves.toEqual({
        type: "error",
        message: "Session expired",
      });
      await vi.waitFor(() => expect(fixture.clientClose).toHaveBeenCalledOnce());
      expect(fixture.subscriptionClose).toHaveBeenCalledOnce();
      await reader.cancel();
    }
  });

  it("cleans up at session expiry even when an event write is backpressured", async () => {
    vi.useFakeTimers();
    const fixture = createClient();
    const managed = createManagedEventHubStream({
      client: fixture.client,
      expectedPartitionIds: ["0", "1"],
      request: { consumerGroup: "$Default", lookbackMinutes: 1 },
      sessionExpiresAt: 1,
      revalidateSession: async () => true,
      heartbeatIntervalMs: 60_000,
      now: () => 0,
    });
    const processing = fixture.getHandlers().processEvents(
      [
        {
          body: { message: "allow" },
          enqueuedTimeUtc: new Date("2026-07-12T12:00:00.000Z"),
          sequenceNumber: 42,
        },
      ],
      createPartitionContext("1"),
    );

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(fixture.clientClose).toHaveBeenCalledOnce());
    expect(fixture.subscriptionClose).toHaveBeenCalledOnce();
    await processing;
    await managed.cleanup();
  });
});
