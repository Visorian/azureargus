import { effectScope, nextTick, reactive, ref } from "vue";

import { createDefaultLogFilters } from "../../app/composables/useLogQuery";
import { createDefaultLogSort } from "../../app/composables/useLogSorting";
import { useLogAnalyticsQuery } from "../../app/composables/useLogAnalyticsQuery";
import {
  createDefaultLogAnalysisDateRange,
  hasLogAnalysisRole,
  parseLogAnalysisDateRange,
} from "../../app/utils/logAnalysis";
import type { FirewallLogRecord } from "../../app/types/firewall";
import type {
  LogAnalyticsQueryRequest,
  LogAnalyticsQueryResponse,
} from "../../shared/types/logAnalytics";

function createRecord(id: string): FirewallLogRecord {
  return {
    id,
    timestamp: "2026-07-10T10:00:00.000Z",
    category: "AZFWNetworkRule",
    action: "Allow",
    protocol: "TCP",
    message: id,
    raw: {},
    searchableText: id,
  };
}

function response(id: string): LogAnalyticsQueryResponse {
  return {
    records: [createRecord(id)],
    truncated: false,
    limit: 1_000,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("Log analysis client", () => {
  it("creates and validates local date ranges", () => {
    const range = createDefaultLogAnalysisDateRange(new Date("2026-07-10T12:00:00.000Z"));
    const parsed = parseLogAnalysisDateRange(range);

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(new Date(parsed.value.to).getTime() - new Date(parsed.value.from).getTime()).toBe(
        15 * 60_000,
      );
    }
    expect(parseLogAnalysisDateRange({ from: "2026-07-10T12:00", to: "2026-07-09T12:00" })).toEqual(
      { error: "Start date must be before end date.", ok: false },
    );
  });

  it("requires the Log Analysis app role", () => {
    expect(hasLogAnalysisRole({ claims: { roles: ["LogAnalysis.Read"] } })).toBe(true);
    expect(hasLogAnalysisRole({ claims: { roles: ["Other"] } })).toBe(false);
    expect(hasLogAnalysisRole(null)).toBe(false);
  });

  it("runs explicitly, debounces refinements, and clears state", async () => {
    vi.useFakeTimers();
    const requests: LogAnalyticsQueryRequest[] = [];
    const active = ref(true);
    const filters = reactive(createDefaultLogFilters());
    const sort = reactive(createDefaultLogSort());
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active,
        filters,
        request: async (body) => {
          requests.push(body);
          return response(`query-${requests.length}`);
        },
        sort,
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }
    expect(requests).toEqual([]);

    await query.run();
    expect(requests).toHaveLength(1);
    expect(query.hasRun.value).toBe(true);
    expect(query.records.value.map((record) => record.id)).toEqual(["query-1"]);

    query.scheduleRefinement(true);
    await Promise.resolve();
    expect(requests).toHaveLength(1);

    filters.action = "Deny";
    await nextTick();
    expect(query.refinementPending.value).toBe(true);
    vi.advanceTimersByTime(499);
    await Promise.resolve();
    expect(requests).toHaveLength(1);

    vi.advanceTimersByTime(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toHaveLength(2);
    expect(requests[1]?.filters.action).toBe("Deny");

    filters.protocol = "UDP";
    await nextTick();
    query.scheduleRefinement(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(requests).toHaveLength(3);
    expect(requests[2]?.filters.protocol).toBe("UDP");

    query.clear();
    expect(query.hasRun.value).toBe(false);
    expect(query.records.value).toEqual([]);
    expect(query.status.value).toBe("idle");
    expect(query.refinementPending.value).toBe(false);

    scope.stop();
    vi.useRealTimers();
  });

  it("initializes range when Log Analysis first becomes active", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 6, 10, 10, 0));
    const active = ref(false);
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active,
        filters: reactive(createDefaultLogFilters()),
        request: async () => response("unused"),
        sort: reactive(createDefaultLogSort()),
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }

    vi.setSystemTime(new Date(2026, 6, 10, 11, 0));
    active.value = true;
    await nextTick();
    expect(query.draftRange).toEqual({
      from: "2026-07-10T10:45",
      to: "2026-07-10T11:00",
    });

    active.value = false;
    await nextTick();
    vi.setSystemTime(new Date(2026, 6, 10, 12, 0));
    active.value = true;
    await nextTick();
    expect(query.draftRange.to).toBe("2026-07-10T11:00");

    scope.stop();
    vi.useRealTimers();
  });

  it("keeps only latest query response", async () => {
    const requests = [
      createDeferred<LogAnalyticsQueryResponse>(),
      createDeferred<LogAnalyticsQueryResponse>(),
    ];
    let requestIndex = 0;
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active: ref(true),
        filters: reactive(createDefaultLogFilters()),
        request: () => requests[requestIndex++]!.promise,
        sort: reactive(createDefaultLogSort()),
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }

    const firstRun = query.run();
    const secondRun = query.run();
    requests[1]!.resolve(response("latest"));
    await secondRun;
    requests[0]!.resolve(response("stale"));
    await firstRun;

    expect(query.records.value.map((record) => record.id)).toEqual(["latest"]);
    scope.stop();
  });

  it("aborts an active request without surfacing an error", async () => {
    let requestSignal: AbortSignal | undefined;
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active: ref(true),
        filters: reactive(createDefaultLogFilters()),
        request: (_body, signal) => {
          requestSignal = signal;
          return new Promise<LogAnalyticsQueryResponse>((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("Aborted", "AbortError")),
            );
          });
        },
        sort: reactive(createDefaultLogSort()),
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }

    const run = query.run();
    query.abort();

    await expect(run).resolves.toBe(false);
    expect(requestSignal?.aborted).toBe(true);
    expect(query.lastError.value).toBeNull();
    expect(query.status.value).toBe("idle");
    scope.stop();
  });

  it("cancels pending refinement when Log Analysis becomes inactive", async () => {
    vi.useFakeTimers();
    const active = ref(true);
    const filters = reactive(createDefaultLogFilters());
    const request = vi.fn(async () => response("result"));
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active,
        filters,
        request,
        sort: reactive(createDefaultLogSort()),
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }

    await query.run();
    filters.action = "Deny";
    await nextTick();
    expect(query.refinementPending.value).toBe(true);

    active.value = false;
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);

    expect(query.refinementPending.value).toBe(false);
    expect(request).toHaveBeenCalledOnce();
    scope.stop();
    vi.useRealTimers();
  });

  it("preserves prior records when refinement fails and allows immediate retry", async () => {
    vi.useFakeTimers();
    const filters = reactive(createDefaultLogFilters());
    const onError = vi.fn();
    let requestCount = 0;
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active: ref(true),
        filters,
        onError,
        request: async () => {
          requestCount += 1;
          if (requestCount === 2) {
            throw new Error("refinement failed");
          }
          return response(requestCount === 1 ? "initial" : "retried");
        },
        sort: reactive(createDefaultLogSort()),
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }

    await query.run();
    filters.protocol = "UDP";
    await nextTick();
    await vi.advanceTimersByTimeAsync(500);

    expect(query.records.value.map((record) => record.id)).toEqual(["initial"]);
    expect(query.status.value).toBe("success");
    expect(query.lastError.value).toBe("refinement failed");
    expect(onError).toHaveBeenCalledWith("refinement failed");

    query.scheduleRefinement(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(query.records.value.map((record) => record.id)).toEqual(["retried"]);

    scope.stop();
    vi.useRealTimers();
  });

  it("aborts an active query and marks previous results dirty when date range changes", async () => {
    const secondRequest = createDeferred<LogAnalyticsQueryResponse>();
    let secondSignal: AbortSignal | undefined;
    let requestCount = 0;
    const scope = effectScope();
    const query = scope.run(() =>
      useLogAnalyticsQuery({
        active: ref(true),
        filters: reactive(createDefaultLogFilters()),
        request: (_body, signal) => {
          requestCount += 1;
          if (requestCount === 1) {
            return Promise.resolve(response("initial"));
          }
          secondSignal = signal;
          signal.addEventListener("abort", () =>
            secondRequest.reject(new DOMException("Aborted", "AbortError")),
          );
          return secondRequest.promise;
        },
        sort: reactive(createDefaultLogSort()),
      }),
    );

    expect(query).toBeDefined();
    if (!query) {
      return;
    }

    await query.run();
    const rerun = query.run();
    query.draftRange.from = "";
    await nextTick();

    await expect(rerun).resolves.toBe(false);
    expect(secondSignal?.aborted).toBe(true);
    expect(query.records.value.map((record) => record.id)).toEqual(["initial"]);
    expect(query.rangeDirty.value).toBe(true);
    scope.stop();
  });
});
