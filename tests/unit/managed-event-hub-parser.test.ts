import { consumeManagedEventHubStream } from "../../app/utils/managedEventHubStream";
import type { ManagedEventHubStreamEnvelope } from "../../shared/types/managedEventHub";

describe("managed Event Hub NDJSON parser", () => {
  it("reassembles split chunks and parses multiple envelopes per chunk", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"heart'));
        controller.enqueue(
          encoder.encode(
            'beat"}\n{"type":"events","events":[{"body":{"msg":"allow"},"enqueuedTimeUtc":"2026-07-12T12:00:00.000Z",',
          ),
        );
        controller.enqueue(
          encoder.encode(
            '"offset":"123","partitionId":"0","sequenceNumber":7}]}\n{"type":"error","message":"Session expired"}',
          ),
        );
        controller.close();
      },
    });
    const envelopes: ManagedEventHubStreamEnvelope[] = [];

    await consumeManagedEventHubStream(
      stream,
      (envelope) => envelopes.push(envelope),
      new AbortController().signal,
    );

    expect(envelopes).toEqual([
      { type: "heartbeat" },
      {
        type: "events",
        events: [
          {
            body: { msg: "allow" },
            enqueuedTimeUtc: "2026-07-12T12:00:00.000Z",
            offset: "123",
            partitionId: "0",
            sequenceNumber: 7,
          },
        ],
      },
      { type: "error", message: "Session expired" },
    ]);
  });
});
