import type { Ref } from "vue";

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

export function useBoundedLogBuffer<T>(key: string, maxSize: Readonly<Ref<number>>) {
  const items = useState<T[]>(key, () => []);

  function pushMany(nextItems: readonly T[]) {
    if (nextItems.length === 0) {
      return;
    }

    items.value = prependToBoundedBuffer(items.value, nextItems, maxSize.value);
  }

  function clear() {
    items.value = [];
  }

  return {
    items,
    pushMany,
    clear,
  };
}
