import { effectScope, nextTick, ref } from "vue";

import {
  type DnsReadinessTarget,
  useDnsSourceReadiness,
} from "../../app/composables/useDnsSourceReadiness";
import type { DnsReadinessResponse } from "../../shared/types/dns";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function response(sampleCount: 0 | 1 | 2): DnsReadinessResponse {
  return {
    readiness: [{ source: "proxy-structured", status: "success", sampleCount }],
  };
}

describe("DNS source readiness client", () => {
  it("loads immediately when a workspace target becomes available", async () => {
    const target = ref<DnsReadinessTarget | null>(null);
    const request = vi.fn<
      (target: DnsReadinessTarget, signal: AbortSignal) => Promise<DnsReadinessResponse>
    >(async () => response(2));
    const scope = effectScope();
    const readiness = scope.run(() => useDnsSourceReadiness({ request, target }));
    if (!readiness) throw new Error("Readiness composable was not created.");

    expect(request).not.toHaveBeenCalled();
    expect(readiness.status.value).toBe("idle");

    target.value = { mode: "managed" };
    await nextTick();
    await vi.waitFor(() => expect(readiness.status.value).toBe("success"));

    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith({ mode: "managed" }, expect.any(AbortSignal));
    expect(readiness.readiness.value).toEqual(response(2).readiness);
    scope.stop();
  });

  it("aborts and ignores stale readiness when workspace changes", async () => {
    const first = createDeferred<DnsReadinessResponse>();
    const second = createDeferred<DnsReadinessResponse>();
    const signals: AbortSignal[] = [];
    const request = vi.fn<
      (target: DnsReadinessTarget, signal: AbortSignal) => Promise<DnsReadinessResponse>
    >((target, signal) => {
      signals.push(signal);
      return target.mode === "delegated" && target.workspaceId.endsWith("1")
        ? first.promise
        : second.promise;
    });
    const target = ref<DnsReadinessTarget | null>({
      mode: "delegated",
      tenantId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222221",
    });
    const scope = effectScope();
    const readiness = scope.run(() => useDnsSourceReadiness({ request, target }));
    if (!readiness) throw new Error("Readiness composable was not created.");
    await nextTick();

    target.value = {
      mode: "delegated",
      tenantId: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
    };
    await nextTick();
    expect(signals[0]?.aborted).toBe(true);

    first.resolve(response(1));
    second.resolve(response(2));
    await vi.waitFor(() => expect(readiness.status.value).toBe("success"));
    expect(readiness.readiness.value).toEqual(response(2).readiness);
    scope.stop();
  });

  it("clears readiness when workspace target is removed", async () => {
    const deferred = createDeferred<DnsReadinessResponse>();
    let signal: AbortSignal | undefined;
    const target = ref<DnsReadinessTarget | null>({ mode: "managed" });
    const scope = effectScope();
    const readiness = scope.run(() =>
      useDnsSourceReadiness({
        request: async (_target, nextSignal) => {
          signal = nextSignal;
          return deferred.promise;
        },
        target,
      }),
    );
    if (!readiness) throw new Error("Readiness composable was not created.");
    await nextTick();

    target.value = null;
    await nextTick();

    expect(signal?.aborted).toBe(true);
    expect(readiness.status.value).toBe("idle");
    expect(readiness.readiness.value).toEqual([]);
    scope.stop();
  });
});
