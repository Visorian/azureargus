import {
  prependToBoundedBuffer,
  trimToBufferSize,
} from "../../app/composables/useBoundedLogBuffer";

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
});
