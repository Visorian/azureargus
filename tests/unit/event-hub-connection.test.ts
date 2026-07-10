import {
  createInitialEventHubConnectionForm,
  EVENT_HUB_LOOKBACK_OPTIONS,
  getEventHubLookbackStart,
  getEventHubName,
  getRawLogBufferSize,
  isEventHubLookbackMinutes,
  MAX_RAW_BUFFER_SIZE,
  normalizeEventHubLookbackMinutes,
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

  it("defines fixed typed lookback options with exact labels", () => {
    expect(EVENT_HUB_LOOKBACK_OPTIONS).toEqual([
      { label: "Last 1 minute", value: 1 },
      { label: "Last 3 minutes", value: 3 },
      { label: "Last 5 minutes", value: 5 },
      { label: "Last 10 minutes", value: 10 },
      { label: "Last 15 minutes", value: 15 },
    ]);
  });

  it("normalizes unsupported lookback defaults to 15 minutes", () => {
    expect(normalizeEventHubLookbackMinutes(3)).toBe(3);
    expect(normalizeEventHubLookbackMinutes(0)).toBe(15);
    expect(normalizeEventHubLookbackMinutes(30)).toBe(15);
    expect(normalizeEventHubLookbackMinutes(Number.NaN)).toBe(15);
    expect(createInitialEventHubConnectionForm(30).lookbackMinutes).toBe(15);
  });

  it("accepts only supported lookback values", () => {
    expect([1, 3, 5, 10, 15].every(isEventHubLookbackMinutes)).toBe(true);
    expect([0, 2, 30, Number.NaN].some(isEventHubLookbackMinutes)).toBe(false);

    const form = createInitialEventHubConnectionForm();
    form.connectionString =
      "Endpoint=sb://example.servicebus.windows.net/;SharedAccessKeyName=Listen;SharedAccessKey=secret;EntityPath=fw-logs";
    Reflect.set(form, "lookbackMinutes", 30);

    expect(validateEventHubConnectionForm(form)).toContain(
      "Lookback window must be 1, 3, 5, 10, or 15 minutes.",
    );
  });

  it("keeps raw retention larger than the visible row limit", () => {
    expect(getRawLogBufferSize(500)).toBe(5_000);
    expect(getRawLogBufferSize(100_000)).toBe(MAX_RAW_BUFFER_SIZE);
  });
});
