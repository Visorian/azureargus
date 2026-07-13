import { onScopeDispose, reactive } from "vue";

import {
  MAX_IP_COUNTRY_BATCH_SIZE,
  MAX_IP_COUNTRY_VALUE_LENGTH,
  isIpCountryLookupResponse,
  type IpCountryLookupRequest,
} from "#shared/types/ipCountry";
import { normalizeCountryCode } from "~/utils/countryFlag";

const DEFAULT_BATCH_DELAY_MS = 50;
const DEFAULT_CACHE_SIZE = 2_048;
const DEFAULT_FAILURE_COOLDOWN_MS = 60_000;

type LookupRequest = (body: IpCountryLookupRequest, signal: AbortSignal) => Promise<unknown>;

interface IpCountryLookupClientOptions {
  batchDelayMs?: number;
  cacheSize?: number;
  failureCooldownMs?: number;
  pendingSize?: number;
}

export interface IpCountryLookupClient {
  dispose(): void;
  getCountryCode(ip: string | undefined): string | null | undefined;
  queue(ip: string | undefined): void;
  setActive(active: boolean): void;
}

function getStatusCode(error: unknown) {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  if ("statusCode" in error && typeof error.statusCode === "number") {
    return error.statusCode;
  }
  if (
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "status" in error.response &&
    typeof error.response.status === "number"
  ) {
    return error.response.status;
  }
  return undefined;
}

function isRetryableStatus(statusCode: number | undefined) {
  return (
    statusCode === undefined ||
    statusCode === 408 ||
    statusCode === 425 ||
    statusCode === 429 ||
    statusCode >= 500
  );
}

export function createIpCountryLookupClient(
  request: LookupRequest,
  {
    batchDelayMs = DEFAULT_BATCH_DELAY_MS,
    cacheSize = DEFAULT_CACHE_SIZE,
    failureCooldownMs = DEFAULT_FAILURE_COOLDOWN_MS,
    pendingSize = DEFAULT_CACHE_SIZE,
  }: IpCountryLookupClientOptions = {},
): IpCountryLookupClient {
  const cache = reactive(new Map<string, string | null>());
  const cacheOrder = new Map<string, true>();
  const queued = new Set<string>();
  const inFlight = new Set<string>();
  let activeController: AbortController | null = null;
  let cooldownUntil = 0;
  let disabled = false;
  let disposed = false;
  let lookupActive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function queueLatest(ip: string) {
    if (queued.size + inFlight.size >= pendingSize) {
      const oldest = queued.values().next().value;
      if (typeof oldest !== "string") {
        return;
      }
      queued.delete(oldest);
    }
    queued.add(ip);
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function touchCache(ip: string) {
    if (!cacheOrder.has(ip)) {
      return;
    }
    cacheOrder.delete(ip);
    cacheOrder.set(ip, true);
  }

  function setCache(ip: string, countryCode: string | null) {
    if (!cache.has(ip) && cache.size >= cacheSize) {
      const oldest = cacheOrder.keys().next().value;
      if (typeof oldest === "string") {
        cacheOrder.delete(oldest);
        cache.delete(oldest);
      }
    }
    cache.set(ip, countryCode);
    cacheOrder.delete(ip);
    cacheOrder.set(ip, true);
  }

  function schedule(delayMs = batchDelayMs) {
    if (
      !lookupActive ||
      disposed ||
      disabled ||
      timer !== null ||
      activeController !== null ||
      queued.size === 0
    ) {
      return;
    }

    timer = setTimeout(
      () => {
        timer = null;
        void flush();
      },
      Math.max(0, delayMs),
    );
  }

  async function flush() {
    if (!lookupActive || disposed || disabled || activeController !== null || queued.size === 0) {
      return;
    }

    const cooldownRemaining = cooldownUntil - Date.now();
    if (cooldownRemaining > 0) {
      schedule(cooldownRemaining);
      return;
    }

    const ips = [...queued].slice(0, MAX_IP_COUNTRY_BATCH_SIZE);
    for (const ip of ips) {
      queued.delete(ip);
      inFlight.add(ip);
    }

    const controller = new AbortController();
    activeController = controller;
    let retryIps: string[] = [];

    try {
      const response = await request({ ips }, controller.signal);
      if (!isIpCountryLookupResponse(response)) {
        disabled = true;
        queued.clear();
        return;
      }
      const results = new Map(
        response.results
          .filter((result) => ips.includes(result.ip))
          .map((result) => [result.ip, normalizeCountryCode(result.countryCode)]),
      );
      for (const ip of ips) {
        setCache(ip, results.get(ip) ?? null);
      }
    } catch (error) {
      if (!disposed && !controller.signal.aborted) {
        const statusCode = getStatusCode(error);
        if (statusCode === 503 || !isRetryableStatus(statusCode)) {
          disabled = true;
          queued.clear();
        } else {
          cooldownUntil = Date.now() + failureCooldownMs;
          retryIps = ips;
        }
      }
    } finally {
      for (const ip of ips) {
        inFlight.delete(ip);
      }
      if (activeController === controller) {
        activeController = null;
      }
      for (const ip of retryIps) {
        if (queued.size + inFlight.size >= pendingSize) {
          break;
        }
        queued.add(ip);
      }
      schedule(Math.max(batchDelayMs, cooldownUntil - Date.now()));
    }
  }

  function queue(ip: string | undefined) {
    const normalizedIp = ip?.trim();
    if (
      !normalizedIp ||
      normalizedIp.length > MAX_IP_COUNTRY_VALUE_LENGTH ||
      !lookupActive ||
      disposed ||
      disabled
    ) {
      return;
    }
    if (cache.has(normalizedIp)) {
      touchCache(normalizedIp);
      return;
    }
    if (queued.has(normalizedIp) || inFlight.has(normalizedIp)) {
      return;
    }

    queueLatest(normalizedIp);
    schedule(Math.max(batchDelayMs, cooldownUntil - Date.now()));
  }

  function getCountryCode(ip: string | undefined) {
    const normalizedIp = ip?.trim();
    return normalizedIp ? cache.get(normalizedIp) : undefined;
  }

  function dispose() {
    disposed = true;
    clearTimer();
    activeController?.abort();
    activeController = null;
    queued.clear();
    inFlight.clear();
  }

  function setActive(active: boolean) {
    lookupActive = active;
    if (active) return;
    clearTimer();
    activeController?.abort();
    activeController = null;
    queued.clear();
  }

  return { dispose, getCountryCode, queue, setActive };
}

export function useIpCountryLookup() {
  const requestFetch = useRequestFetch();
  const client = createIpCountryLookupClient((body, signal) =>
    requestFetch<unknown>("/api/ip-country", {
      body,
      method: "POST",
      signal,
    }),
  );
  onScopeDispose(client.dispose);
  return client;
}
