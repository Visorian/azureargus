export const EVENT_HUB_CONNECTION_STRING_STORAGE_KEY = "azure-argus:event-hub-connection-string";

export interface EventHubConnectionStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export function readStoredEventHubConnectionString(storage: EventHubConnectionStorage) {
  return storage.getItem(EVENT_HUB_CONNECTION_STRING_STORAGE_KEY);
}

export function storeEventHubConnectionString(
  storage: EventHubConnectionStorage,
  connectionString: string,
) {
  storage.setItem(EVENT_HUB_CONNECTION_STRING_STORAGE_KEY, connectionString);
}

export function clearStoredEventHubConnectionString(storage: EventHubConnectionStorage) {
  storage.removeItem(EVENT_HUB_CONNECTION_STRING_STORAGE_KEY);
}
