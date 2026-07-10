import { eventsToFirewallLogs } from "../../app/composables/useEventHubReceiver";

describe("Event Hub receiver helpers", () => {
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
      "0:10:7:2026-07-09T12:00:00.000Z",
      "0:10:8:2026-07-09T12:00:01.000Z",
      "0:11:9:2026-07-09T12:00:02.000Z",
    ]);
  });
});
