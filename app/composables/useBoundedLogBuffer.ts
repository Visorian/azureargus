import type { Ref } from "vue";

export function trimToBufferSize<T>(items: readonly T[], maxSize: number) {
  const boundedSize = Number.isFinite(maxSize) ? Math.max(0, Math.floor(maxSize)) : 0;
  if (items.length <= boundedSize) {
    return [...items];
  }

  return items.slice(0, boundedSize);
}

export function useBoundedLogBuffer<T>(key: string, maxSize: Readonly<Ref<number>>) {
  const items = useState<T[]>(key, () => []);

  function pushMany(nextItems: readonly T[]) {
    if (nextItems.length === 0) {
      return;
    }

    items.value = trimToBufferSize([...nextItems].reverse().concat(items.value), maxSize.value);
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
