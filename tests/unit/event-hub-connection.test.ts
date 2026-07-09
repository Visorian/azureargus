import {
  createInitialEventHubConnectionForm,
  getEventHubLookbackStart,
  getEventHubName,
  getRawLogBufferSize,
  MAX_RAW_BUFFER_SIZE,
  parseEventHubConnectionString,
  validateEventHubConnectionForm,
} from "../../app/composables/useEventHubConnection";

describe("Event Hub connection helpers", () => {
  it("parses connection string values case-insensitively", () => {
    const values = parseEventHubConnectionString(
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs",
    );

    expect(values.get("endpoint")).toBe("sb://example.servicebus.windows.net/");
    expect(values.get("entitypath")).toBe("fw-logs");
  });

  it("uses EntityPath before explicit Event Hub name", () => {
    const form = createInitialEventHubConnectionForm();
    form.connectionString =
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";
    form.eventHubName = "other";

    expect(getEventHubName(form)).toBe("fw-logs");
  });

  it("validates required SAS fields", () => {
    const form = createInitialEventHubConnectionForm();
    form.connectionString = "Endpoint=sb://example.servicebus.windows.net/";

    expect(validateEventHubConnectionForm(form)).toEqual([
      "Connection string must include SharedAccessKeyName.",
      "Connection string must include SharedAccessKey.",
      "Event Hub name is required when EntityPath is not present.",
    ]);
  });

  it("calculates lookback start time", () => {
    const now = new Date("2026-07-09T12:00:00.000Z");

    expect(getEventHubLookbackStart(15, now).toISOString()).toBe("2026-07-09T11:45:00.000Z");
  });

  it("keeps raw retention larger than the visible row limit", () => {
    expect(getRawLogBufferSize(500)).toBe(5_000);
    expect(getRawLogBufferSize(100_000)).toBe(MAX_RAW_BUFFER_SIZE);
  });
});
