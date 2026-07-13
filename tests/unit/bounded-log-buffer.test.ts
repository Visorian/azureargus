import { effectScope, isRef, ref, type Ref } from "vue";

import {
  prependToBoundedBuffer,
  trimToBufferSize,
  useBoundedLogBuffer,
} from "../../app/composables/useBoundedLogBuffer";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("useState", <T>(_key: string, initialize: () => T | Ref<T>) => {
    const initial = initialize();
    return isRef(initial) ? initial : ref(initial);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("bounded log buffer helpers", () => {
  it("keeps newest-first items at the front of the buffer", () => {
    expect(trimToBufferSize(["newest", "middle", "oldest"], 2)).toEqual(["newest", "middle"]);
  });

  it("normalizes invalid buffer sizes to an empty buffer", () => {
    expect(trimToBufferSize(["newest"], Number.NaN)).toEqual([]);
  });

  it("prepends incoming batches with the current newest-first ordering", () => {
    expect(prependToBoundedBuffer(["old-1", "old-2"], ["batch-old", "batch-new"], 3)).toEqual([
      "batch-new",
      "batch-old",
      "old-1",
    ]);
  });

  it("keeps newest incoming items when the incoming batch exceeds capacity", () => {
    expect(prependToBoundedBuffer(["old"], ["oldest", "middle", "newest"], 2)).toEqual([
      "newest",
      "middle",
    ]);
  });

  it("retains current items only up to remaining capacity", () => {
    expect(prependToBoundedBuffer(["old-1", "old-2", "old-3"], ["new"], 3)).toEqual([
      "new",
      "old-1",
      "old-2",
    ]);
  });

  it("normalizes invalid prepend buffer sizes to an empty buffer", () => {
    expect(prependToBoundedBuffer(["old"], ["new"], Number.NaN)).toEqual([]);
    expect(prependToBoundedBuffer(["old"], ["new"], 0)).toEqual([]);
  });

  it("keeps current items when prepending an empty batch", () => {
    expect(prependToBoundedBuffer(["newest", "oldest"], [], 5)).toEqual(["newest", "oldest"]);
  });

  it("publishes only visible rows on the coalesced interval", () => {
    const buffer = useBoundedLogBuffer<{ id: number }>("test", ref(5), {
      publishedSize: ref(2),
    });
    const records = [{ id: 1 }, { id: 2 }, { id: 3 }];

    buffer.pushMany(records);

    expect(buffer.getRawItems().map((record) => record.id)).toEqual([3, 2, 1]);
    expect(buffer.items.value).toEqual([]);
    vi.advanceTimersByTime(249);
    expect(buffer.items.value).toEqual([]);

    vi.advanceTimersByTime(1);
    expect(buffer.items.value.map((record: { id: number }) => record.id)).toEqual([3, 2]);
    expect(buffer.version.value).toBe(1);
  });

  it("flushes a pending publication immediately and cancels its timer", () => {
    const buffer = useBoundedLogBuffer<string>("test", ref(5), {
      publishedSize: ref(2),
    });

    buffer.pushMany(["old", "new"]);
    buffer.flush();

    expect(buffer.items.value).toEqual(["new", "old"]);
    expect(buffer.version.value).toBe(1);
    vi.advanceTimersByTime(250);
    expect(buffer.version.value).toBe(1);
  });

  it("cancels pending publication when its reactive scope is disposed", () => {
    const scope = effectScope();
    const buffer = scope.run(() => useBoundedLogBuffer<string>("test", ref(5)));
    if (!buffer) {
      throw new Error("Buffer was not created.");
    }

    buffer.pushMany(["pending"]);
    scope.stop();
    vi.advanceTimersByTime(250);

    expect(buffer.items.value).toEqual([]);
    expect(buffer.version.value).toBe(0);
  });
});
