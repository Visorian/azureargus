export const DEFAULT_CONSUMER_GROUP = "$Default";
export const DEFAULT_LOOKBACK_MINUTES = 15;
export const DEFAULT_BUFFER_SIZE = 5_000;
export const RAW_BUFFER_MULTIPLIER = 10;
export const MAX_RAW_BUFFER_SIZE = 50_000;

export function getRawLogBufferSize(visibleLimit: number) {
  const boundedLimit = Number.isFinite(visibleLimit) ? Math.max(0, Math.floor(visibleLimit)) : 0;
  return Math.min(
    Math.max(boundedLimit, boundedLimit * RAW_BUFFER_MULTIPLIER),
    MAX_RAW_BUFFER_SIZE,
  );
}

export interface EventHubConnectionForm {
  connectionString: string;
  consumerGroup: string;
  eventHubName: string;
  lookbackMinutes: number;
  bufferSize: number;
}

export function createInitialEventHubConnectionForm(
  defaultLookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
): EventHubConnectionForm {
  return {
    connectionString: "",
    consumerGroup: DEFAULT_CONSUMER_GROUP,
    eventHubName: "",
    lookbackMinutes: defaultLookbackMinutes,
    bufferSize: DEFAULT_BUFFER_SIZE,
  };
}

export function parseEventHubConnectionString(connectionString: string) {
  const values = new Map<string, string>();

  for (const part of connectionString.split(";")) {
    const separatorIndex = part.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (key.length > 0 && value.length > 0) {
      values.set(key.toLowerCase(), value);
    }
  }

  return values;
}

export function getEventHubName(form: EventHubConnectionForm) {
  const values = parseEventHubConnectionString(form.connectionString);
  return values.get("entitypath") || form.eventHubName.trim();
}

export function getEventHubLookbackStart(lookbackMinutes: number, now = new Date()) {
  const boundedMinutes = Number.isFinite(lookbackMinutes) ? Math.max(0, lookbackMinutes) : 0;
  return new Date(now.getTime() - boundedMinutes * 60_000);
}

export function validateEventHubConnectionForm(form: EventHubConnectionForm) {
  const errors: string[] = [];
  const values = parseEventHubConnectionString(form.connectionString);

  if (form.connectionString.trim().length === 0) {
    errors.push("Connection string is required.");
  }

  if (!values.has("endpoint")) {
    errors.push("Connection string must include Endpoint.");
  }

  if (!values.has("sharedaccesskeyname")) {
    errors.push("Connection string must include SharedAccessKeyName.");
  }

  if (!values.has("sharedaccesskey")) {
    errors.push("Connection string must include SharedAccessKey.");
  }

  if (!getEventHubName(form)) {
    errors.push("Event Hub name is required when EntityPath is not present.");
  }

  if (form.consumerGroup.trim().length === 0) {
    errors.push("Consumer group is required.");
  }

  if (!Number.isFinite(form.lookbackMinutes) || form.lookbackMinutes < 0) {
    errors.push("Lookback window must be zero or more minutes.");
  }

  if (!Number.isInteger(form.bufferSize) || form.bufferSize < 100) {
    errors.push("Visible row limit must be at least 100 log entries.");
  }

  return errors;
}
