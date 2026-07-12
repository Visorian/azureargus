import { ref, type Ref } from "vue";
import { onBeforeRouteLeave } from "vue-router";

export type AnalysisMode = "real-time-analysis" | "log-analysis";

interface UseAnalysisModeOptions {
  abortLogAnalysis(): void;
  canUseLogAnalysis: Readonly<Ref<boolean>>;
  closeDetail(): void;
  disconnectRealTime(): Promise<void>;
  mode: Ref<AnalysisMode>;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not switch analysis mode.";
}

export function useAnalysisMode(options: UseAnalysisModeOptions) {
  const transitioning = ref(false);
  const lastError = ref<string | null>(null);

  async function setMode(nextMode: AnalysisMode) {
    if (nextMode === options.mode.value || transitioning.value) {
      return nextMode === options.mode.value;
    }
    if (nextMode === "log-analysis" && !options.canUseLogAnalysis.value) {
      lastError.value = "Log analysis requires sign-in.";
      return false;
    }

    transitioning.value = true;
    lastError.value = null;
    try {
      if (nextMode === "log-analysis") {
        await options.disconnectRealTime();
      } else {
        options.abortLogAnalysis();
      }

      options.closeDetail();
      options.mode.value = nextMode;
      return true;
    } catch (error: unknown) {
      lastError.value = getErrorMessage(error);
      return false;
    } finally {
      transitioning.value = false;
    }
  }

  onBeforeRouteLeave(async () => {
    options.abortLogAnalysis();
    try {
      await options.disconnectRealTime();
    } catch {
      // Navigation should not trap the user after teardown was attempted.
    }
  });

  return {
    lastError,
    setMode,
    transitioning,
  };
}
