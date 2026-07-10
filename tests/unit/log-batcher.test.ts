import { createLogBatcher } from "../../app/composables/useLogBatcher";
import { prependToBoundedBuffer } from "../../app/composables/useBoundedLogBuffer";

describe("log batcher", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes multiple pushes as one batch", () => {
    const flushedItems: string[][] = [];
    const batcher = createLogBatcher<string>({
      flushIntervalMs: 100,
      onFlush: (items) => flushedItems.push([...items]),
    });

    batcher.pushMany(["old"]);
    batcher.pushMany(["new"]);

    expect(flushedItems).toEqual([]);
    vi.advanceTimersByTime(100);

    expect(flushedItems).toEqual([["old", "new"]]);
    expect(batcher.pendingCount).toBe(0);
  });

  it("clears pending items before the timer flushes", () => {
    const flushedItems: string[][] = [];
    const batcher = createLogBatcher<string>({
      flushIntervalMs: 100,
      onFlush: (items) => flushedItems.push([...items]),
    });

    batcher.pushMany(["pending"]);
    batcher.clear();
    vi.advanceTimersByTime(100);

    expect(flushedItems).toEqual([]);
    expect(batcher.pendingCount).toBe(0);
  });

  it("manual flush cancels the scheduled timer", () => {
    const flushedItems: string[][] = [];
    const batcher = createLogBatcher<string>({
      flushIntervalMs: 100,
      onFlush: (items) => flushedItems.push([...items]),
    });

    batcher.pushMany(["pending"]);
    batcher.flush();
    vi.advanceTimersByTime(100);

    expect(flushedItems).toEqual([["pending"]]);
  });

  it("flushes pending records before teardown and preserves final buffer order", () => {
    let buffer: string[] = [];
    const batcher = createLogBatcher<string>({
      flushIntervalMs: 100,
      onFlush: (items) => {
        buffer = prependToBoundedBuffer(buffer, items, 10);
      },
    });

    batcher.pushMany(["old"]);
    batcher.pushMany(["new"]);
    batcher.flush();
    vi.advanceTimersByTime(100);

    expect(buffer).toEqual(["new", "old"]);
  });
});
