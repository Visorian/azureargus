import { getCurrentScope, onScopeDispose, ref, shallowRef, toRaw, type Ref } from "vue";

export const DEFAULT_LOG_UI_PUBLISH_INTERVAL_MS = 250;

interface BoundedLogBufferOptions {
  publishIntervalMs?: number;
  publishedSize?: Readonly<Ref<number>>;
}

function normalizeBufferSize(maxSize: number) {
  return Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : 0;
}

export function trimToBufferSize<T>(items: readonly T[], maxSize: number) {
  const boundedSize = normalizeBufferSize(maxSize);
  if (items.length <= boundedSize) {
    return [...items];
  }

  return items.slice(0, boundedSize);
}

export function prependToBoundedBuffer<T>(
  currentItems: readonly T[],
  nextItems: readonly T[],
  maxSize: number,
) {
  const boundedSize = normalizeBufferSize(maxSize);
  if (boundedSize === 0) {
    return [];
  }

  if (nextItems.length === 0) {
    return trimToBufferSize(currentItems, boundedSize);
  }

  const result: T[] = [];

  for (
    let nextIndex = nextItems.length - 1;
    nextIndex >= 0 && result.length < boundedSize;
    nextIndex -= 1
  ) {
    result.push(nextItems[nextIndex]!);
  }

  for (
    let currentIndex = 0;
    currentIndex < currentItems.length && result.length < boundedSize;
    currentIndex += 1
  ) {
    result.push(currentItems[currentIndex]!);
  }

  return result;
}

export function useBoundedLogBuffer<T>(
  key: string,
  maxSize: Readonly<Ref<number>>,
  {
    publishIntervalMs = DEFAULT_LOG_UI_PUBLISH_INTERVAL_MS,
    publishedSize = maxSize,
  }: BoundedLogBufferOptions = {},
) {
  const items = useState<T[]>(key, () => shallowRef<T[]>([]));
  const version = ref(0);
  let rawItems = items.value.map((item) => toRaw(item));
  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let publishPending = false;

  function cancelPublish() {
    if (publishTimer === undefined) {
      return;
    }

    clearTimeout(publishTimer);
    publishTimer = undefined;
  }

  function publish() {
    cancelPublish();
    if (!publishPending) {
      return;
    }

    publishPending = false;
    items.value = trimToBufferSize(rawItems, publishedSize.value);
    version.value += 1;
  }

  function schedulePublish() {
    if (publishTimer !== undefined) {
      return;
    }
    if (publishIntervalMs <= 0) {
      publish();
      return;
    }

    publishTimer = setTimeout(publish, publishIntervalMs);
  }

  function pushMany(nextItems: readonly T[]) {
    if (nextItems.length === 0) {
      return;
    }

    rawItems = prependToBoundedBuffer(rawItems, nextItems, maxSize.value);
    publishPending = true;
    schedulePublish();
  }

  function clear() {
    cancelPublish();
    rawItems = [];
    publishPending = false;
    items.value = [];
    version.value += 1;
  }

  if (getCurrentScope()) {
    onScopeDispose(cancelPublish);
  }

  return {
    clear,
    flush: publish,
    getRawItems: () => rawItems as readonly T[],
    items,
    pushMany,
    version,
  };
}
