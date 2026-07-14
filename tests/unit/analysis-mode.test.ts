import { ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

import { useAnalysisMode } from "../../app/composables/useAnalysisMode";

vi.mock("vue-router", () => ({
  onBeforeRouteLeave: vi.fn<typeof onBeforeRouteLeave>(),
}));

function createVoidMock() {
  return vi.fn<() => void>();
}

function createAsyncVoidMock() {
  return vi.fn<() => Promise<void>>(async () => undefined);
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(onBeforeRouteLeave).mockClear();
});

describe("analysis mode orchestration", () => {
  it("pauses Real-time without disconnecting before activating Log Analysis", async () => {
    const pauseRealTime = createVoidMock();
    const disconnectRealTime = createAsyncVoidMock();
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: createVoidMock(),
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: createVoidMock(),
      disconnectRealTime,
      mode,
      pauseRealTime,
      resetRealTime: createAsyncVoidMock(),
    });

    await expect(state.setMode("log-analysis")).resolves.toBe(true);
    expect(pauseRealTime).toHaveBeenCalledOnce();
    expect(disconnectRealTime).not.toHaveBeenCalled();
    expect(mode.value).toBe("log-analysis");
  });

  it("blocks Log Analysis without sign-in", async () => {
    const disconnectRealTime = createAsyncVoidMock();
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: createVoidMock(),
      canUseLogAnalysis: ref(false),
      canUseRealTime: ref(true),
      closeDetail: createVoidMock(),
      disconnectRealTime,
      mode,
      pauseRealTime: createVoidMock(),
      resetRealTime: createAsyncVoidMock(),
    });

    await expect(state.setMode("log-analysis")).resolves.toBe(false);
    expect(disconnectRealTime).not.toHaveBeenCalled();
    expect(mode.value).toBe("real-time-analysis");
    expect(state.lastError.value).toBe("Log Analytics is unavailable.");
  });

  it("aborts Log Analysis work before returning to Real-time", async () => {
    const abortLogAnalysis = createVoidMock();
    const closeDetail = createVoidMock();
    const mode = ref<"real-time-analysis" | "log-analysis">("log-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis,
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail,
      disconnectRealTime: createAsyncVoidMock(),
      mode,
      pauseRealTime: createVoidMock(),
      resetRealTime: createAsyncVoidMock(),
    });

    await expect(state.setMode("real-time-analysis")).resolves.toBe(true);
    expect(abortLogAnalysis).toHaveBeenCalledOnce();
    expect(closeDetail).toHaveBeenCalledOnce();
    expect(mode.value).toBe("real-time-analysis");
  });

  it("keeps Real-time active when pausing fails", async () => {
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: createVoidMock(),
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: createVoidMock(),
      disconnectRealTime: createAsyncVoidMock(),
      mode,
      pauseRealTime: vi.fn<() => void>(() => {
        throw new Error("pause failed");
      }),
      resetRealTime: createAsyncVoidMock(),
    });

    await expect(state.setMode("log-analysis")).resolves.toBe(false);
    expect(mode.value).toBe("real-time-analysis");
    expect(state.lastError.value).toBe("pause failed");
  });

  it("aborts Log work and awaits Real-time teardown before route leave completes", async () => {
    const abortLogAnalysis = createVoidMock();
    const disconnect = createDeferred();
    const disconnectRealTime = vi.fn<() => Promise<void>>(() => disconnect.promise);
    useAnalysisMode({
      abortLogAnalysis,
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: createVoidMock(),
      disconnectRealTime,
      mode: ref("real-time-analysis"),
      pauseRealTime: createVoidMock(),
      resetRealTime: createAsyncVoidMock(),
    });
    const guard = vi.mocked(onBeforeRouteLeave).mock.calls.at(-1)?.[0];

    expect(guard).toBeDefined();
    if (!guard) {
      throw new Error("Route leave guard was not registered.");
    }
    const leave = Reflect.apply(guard, undefined, []);
    expect(abortLogAnalysis).toHaveBeenCalledOnce();
    expect(disconnectRealTime).toHaveBeenCalledOnce();

    disconnect.resolve();
    await expect(leave).resolves.toBeUndefined();
  });

  it("resets Real-time once after Log Analysis is actually used", async () => {
    const resetRealTime = createAsyncVoidMock();
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: createVoidMock(),
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: createVoidMock(),
      disconnectRealTime: createAsyncVoidMock(),
      mode,
      pauseRealTime: createVoidMock(),
      resetRealTime,
    });

    await state.setMode("log-analysis");
    await expect(state.commitLogAnalysis()).resolves.toBe(true);
    await expect(state.commitLogAnalysis()).resolves.toBe(false);
    expect(resetRealTime).toHaveBeenCalledOnce();

    await state.setMode("real-time-analysis");
    await expect(state.commitLogAnalysis()).resolves.toBe(false);
    await state.setMode("log-analysis");
    await expect(state.commitLogAnalysis()).resolves.toBe(true);
    expect(resetRealTime).toHaveBeenCalledTimes(2);
  });
});
