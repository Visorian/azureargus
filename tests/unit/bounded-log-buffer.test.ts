import { trimToBufferSize } from "../../app/composables/useBoundedLogBuffer";

describe("bounded log buffer helpers", () => {
  it("keeps newest-first items at the front of the buffer", () => {
    expect(trimToBufferSize(["newest", "middle", "oldest"], 2)).toEqual(["newest", "middle"]);
  });

  it("normalizes invalid buffer sizes to an empty buffer", () => {
    expect(trimToBufferSize(["newest"], Number.NaN)).toEqual([]);
  });
});
