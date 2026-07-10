import type { Ref } from "vue";

import {
  clearStoredEventHubConnectionString,
  readStoredEventHubConnectionString,
  storeEventHubConnectionString,
  type EventHubConnectionStorage,
} from "~/utils/eventHubConnectionStorage";

export function useEventHubConnectionPersistence(connectionString: Ref<string>) {
  const enabled = ref(false);
  const lastError = ref<string | null>(null);
  let initialized = false;
  let storage: EventHubConnectionStorage | null = null;

  function clearStoredValue() {
    if (storage === null) {
      return;
    }

    try {
      clearStoredEventHubConnectionString(storage);
    } catch {
      storage = null;
      lastError.value = "Connection string could not be removed from browser storage.";
    }
  }

  function saveCurrentValue() {
    if (storage === null) {
      return;
    }

    try {
      storeEventHubConnectionString(storage, connectionString.value);
      lastError.value = null;
    } catch {
      storage = null;
      enabled.value = false;
      lastError.value = "Connection string could not be saved in browser storage.";
    }
  }

  onMounted(() => {
    try {
      storage = window.localStorage;
      const storedValue = readStoredEventHubConnectionString(storage);
      if (storedValue !== null) {
        connectionString.value = storedValue;
        enabled.value = true;
      }
    } catch {
      storage = null;
      lastError.value = "Connection string could not be read from browser storage.";
    } finally {
      initialized = true;
    }
  });

  watch(connectionString, () => {
    if (initialized && enabled.value) {
      saveCurrentValue();
    }
  });

  watch(enabled, (shouldPersist) => {
    if (!initialized) {
      return;
    }

    if (shouldPersist) {
      saveCurrentValue();
      return;
    }

    clearStoredValue();
  });

  return {
    enabled,
    lastError,
  };
}
