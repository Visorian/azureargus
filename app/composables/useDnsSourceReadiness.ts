import type { DnsReadinessResponse, DnsSourceReadiness } from "#shared/types/dns";
import { onScopeDispose, ref, shallowRef, watch, type Ref } from "vue";

export type DnsReadinessTarget =
  | { mode: "managed" }
  | { mode: "delegated"; tenantId: string; workspaceId: string };

export type DnsReadinessStatus = "idle" | "loading" | "success" | "error";

type ReadinessRequest = (
  target: DnsReadinessTarget,
  signal: AbortSignal,
) => Promise<DnsReadinessResponse>;

interface UseDnsSourceReadinessOptions {
  request: ReadinessRequest;
  target: Readonly<Ref<DnsReadinessTarget | null>>;
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

export function useDnsSourceReadiness(options: UseDnsSourceReadinessOptions) {
  const readiness = shallowRef<DnsSourceReadiness[]>([]);
  const status = ref<DnsReadinessStatus>("idle");
  const lastError = ref<string | null>(null);
  let controller: AbortController | null = null;
  let generation = 0;

  function abort() {
    generation += 1;
    controller?.abort();
    controller = null;
  }

  async function refresh(target = options.target.value) {
    abort();
    readiness.value = [];
    lastError.value = null;
    if (target === null) {
      status.value = "idle";
      return false;
    }

    const currentGeneration = ++generation;
    const requestController = new AbortController();
    controller = requestController;
    status.value = "loading";
    try {
      const response = await options.request(target, requestController.signal);
      if (currentGeneration !== generation) return false;
      readiness.value = response.readiness;
      status.value = "success";
      return true;
    } catch (error: unknown) {
      if (currentGeneration !== generation || isAbortError(error)) return false;
      lastError.value = "DNS source readiness check failed.";
      status.value = "error";
      return false;
    } finally {
      if (currentGeneration === generation) controller = null;
    }
  }

  watch(options.target, (target) => void refresh(target), { immediate: true });
  onScopeDispose(abort);

  return { abort, lastError, readiness, refresh, status };
}
