import {
  clearStoredEventHubConnectionString,
  readStoredEventHubConnectionString,
  storeEventHubConnectionString,
  type EventHubConnectionStorage,
} from "../../app/utils/eventHubConnectionStorage";

function createMemoryStorage(): EventHubConnectionStorage {
  const values = new Map<string, string>();

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("Event Hub connection storage", () => {
  it("stores, reads, and clears connection string", () => {
    const storage = createMemoryStorage();
    const connectionString =
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret";

    expect(readStoredEventHubConnectionString(storage)).toBeNull();

    storeEventHubConnectionString(storage, connectionString);
    expect(readStoredEventHubConnectionString(storage)).toBe(connectionString);

    clearStoredEventHubConnectionString(storage);
    expect(readStoredEventHubConnectionString(storage)).toBeNull();
  });
});
