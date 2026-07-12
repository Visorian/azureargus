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
  let ignoreEnabledChange = false;
  let hasStoredValue = false;
  let storage: EventHubConnectionStorage | null = null;

  function setEnabledWithoutSync(value: boolean) {
    ignoreEnabledChange = true;
    enabled.value = value;
    ignoreEnabledChange = false;
  }

  function clearStoredValue() {
    if (storage === null) {
      setEnabledWithoutSync(true);
      lastError.value = "Connection string could not be removed from browser storage.";
      return;
    }

    try {
      clearStoredEventHubConnectionString(storage);
      hasStoredValue = false;
      lastError.value = null;
    } catch {
      hasStoredValue = true;
      setEnabledWithoutSync(true);
      lastError.value = "Connection string could not be removed from browser storage.";
    }
  }

  function saveCurrentValue() {
    if (storage === null) {
      setEnabledWithoutSync(hasStoredValue);
      lastError.value = "Connection string could not be saved in browser storage.";
      return;
    }

    try {
      storeEventHubConnectionString(storage, connectionString.value);
      hasStoredValue = true;
      lastError.value = null;
    } catch {
      setEnabledWithoutSync(hasStoredValue);
      lastError.value = "Connection string could not be saved in browser storage.";
    }
  }

  onMounted(() => {
    try {
      storage = window.localStorage;
      const storedValue = readStoredEventHubConnectionString(storage);
      if (storedValue !== null) {
        hasStoredValue = true;
        connectionString.value = storedValue;
        setEnabledWithoutSync(true);
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

  watch(
    enabled,
    (shouldPersist) => {
      if (!initialized || ignoreEnabledChange) {
        return;
      }

      if (shouldPersist) {
        saveCurrentValue();
        return;
      }

      clearStoredValue();
    },
    { flush: "sync" },
  );

  return {
    enabled,
    lastError,
  };
}
