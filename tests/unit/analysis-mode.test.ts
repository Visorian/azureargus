import { ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

import { useAnalysisMode } from "../../app/composables/useAnalysisMode";

vi.mock("vue-router", () => ({
  onBeforeRouteLeave: vi.fn(),
}));

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
  it("waits for Real-time disconnect before activating Log Analysis", async () => {
    const disconnect = createDeferred();
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: vi.fn(),
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: vi.fn(),
      disconnectRealTime: () => disconnect.promise,
      mode,
    });

    const transition = state.setMode("log-analysis");
    expect(state.transitioning.value).toBe(true);
    expect(mode.value).toBe("real-time-analysis");

    disconnect.resolve();
    await expect(transition).resolves.toBe(true);
    expect(mode.value).toBe("log-analysis");
  });

  it("blocks Log Analysis without sign-in", async () => {
    const disconnectRealTime = vi.fn(async () => undefined);
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: vi.fn(),
      canUseLogAnalysis: ref(false),
      canUseRealTime: ref(true),
      closeDetail: vi.fn(),
      disconnectRealTime,
      mode,
    });

    await expect(state.setMode("log-analysis")).resolves.toBe(false);
    expect(disconnectRealTime).not.toHaveBeenCalled();
    expect(mode.value).toBe("real-time-analysis");
    expect(state.lastError.value).toBe("Log Analytics is unavailable.");
  });

  it("aborts Log Analysis work before returning to Real-time", async () => {
    const abortLogAnalysis = vi.fn();
    const closeDetail = vi.fn();
    const mode = ref<"real-time-analysis" | "log-analysis">("log-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis,
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail,
      disconnectRealTime: vi.fn(async () => undefined),
      mode,
    });

    await expect(state.setMode("real-time-analysis")).resolves.toBe(true);
    expect(abortLogAnalysis).toHaveBeenCalledOnce();
    expect(closeDetail).toHaveBeenCalledOnce();
    expect(mode.value).toBe("real-time-analysis");
  });

  it("keeps Real-time active when teardown fails", async () => {
    const mode = ref<"real-time-analysis" | "log-analysis">("real-time-analysis");
    const state = useAnalysisMode({
      abortLogAnalysis: vi.fn(),
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: vi.fn(),
      disconnectRealTime: vi.fn(async () => {
        throw new Error("teardown failed");
      }),
      mode,
    });

    await expect(state.setMode("log-analysis")).resolves.toBe(false);
    expect(mode.value).toBe("real-time-analysis");
    expect(state.lastError.value).toBe("teardown failed");
  });

  it("aborts Log work and awaits Real-time teardown before route leave completes", async () => {
    const abortLogAnalysis = vi.fn();
    const disconnect = createDeferred();
    const disconnectRealTime = vi.fn(() => disconnect.promise);
    useAnalysisMode({
      abortLogAnalysis,
      canUseLogAnalysis: ref(true),
      canUseRealTime: ref(true),
      closeDetail: vi.fn(),
      disconnectRealTime,
      mode: ref("real-time-analysis"),
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
});
